const path = require("path");
const { error, warning, info } = require("./log.js");
const { query, command, run } = require("./runner.js");
const fs = require("fs");

/*
const types = {
    repetable: "R",
    up: "U",
    down: "D",
    repetableBefore: "P",
    before: "B",
    after: "A",
};
*/
const migTypes = {
    repetable: "REPEATABLE",
    up: "VERSION UP",
    down: "VERSION DOWN",
    repetableBefore: "REPEATABLE BEFORE",
    before: "BEFORE MIGRATIONS",
    after: "AFTER MIGRATIONS",
};

const createHistoryTableScript = `
do $$
begin
    if exists(select 1 from information_schema.schemata where schema_name = '{schema}') is false then
        raise info 'create schema %;', '{schema}';
        create schema {schema};
    end if;

    if exists(select 1 from information_schema.tables where table_schema = '{schema}' and table_name = '{name}') is false then
        raise info 'create table %.%;', '{schema}', '{name}';
        create table {schema}.{name}
        (
            rank int,
            name text not null,
            type text not null check (type in ({types})),
            version text,
            script text not null,
            hash text not null,
            installed_by text not null,
            installed_on timestamp with time zone not null default now(),
            execution_time interval not null,
            primary key (name, type)
        );
    end if;
end;
$$;`;

const upsertHistorySql = config => `insert into {historySchema}.{historyName} (name, type, version, script, hash, installed_by, execution_time)
values ('{name}', '{type}', {version}, '{script}', '{hash}', current_user, (clock_timestamp() - ${config.useProceduralScript ? "___clock" : "current_setting('migration.clock')::timestamptz"}))
on conflict (name, type) do update set 
    version = {version}, 
    script = '{script}',
    hash = '{hash}',
    installed_by = current_user,
    installed_on = now(),
    execution_time = (clock_timestamp() - ${config.useProceduralScript ? "___clock" : "current_setting('migration.clock')::timestamptz"});
`;

const tableExistsQuery = `select exists(select 1 from information_schema.tables where table_schema = '{schema}' and table_name = '{name}')`;
const historyQuery = `select coalesce(json_agg(to_json(h)), '[]'::json) from {schema}.{name} h`;

function formatByName(str, obj) {
    return str.replace(/{([^{}]+)}/g, function(match, key) {
        return obj[key] !== undefined ? obj[key] : match;
    });
};

const importTag = "# import";
const envRegex = /\$\{([^}]+)\}/g;

function parseContent(filePath, config, opt) {
    // Read file content as string
    var content = fs.readFileSync(filePath).toString();
    
    // Normalize line endings to LF (Unix style) regardless of OS
    content = content.replace(/\r\n/g, '\n');
    
    if (!config.parseScriptTags && !config.parseEnvVars) {
        return content;
    }

    if (config.parseScriptTags) {
        const lines = content.split("\n");
        const parsedLines = lines.map(line => {
            var importIndexOf = line.indexOf(importTag);
            if (importIndexOf != -1) {
                const filename = line.substring(importIndexOf + importTag.length).trim();
                // Also normalize included file content
                let importedContent = fs.readFileSync(filename, "utf8").replace(/\r\n/g, '\n');
                return `${line}\n${importedContent}`;
            } else {
                return line;
            }
        });
        content = parsedLines.join("\n");
    }

    if (config.parseEnvVars) {
        // replace all ${VAR} with process.env.VAR
        content = content.replace(envRegex, function(match, key) {
            return process.env[key] !== undefined ? process.env[key] : match;
        });
    }

    return content;
}

function validateConfig(config) {
    var mandatory = [
        "upPrefix","downPrefix","repetablePrefix","repetableBeforePrefix",
        "beforePrefix","afterPrefix","separatorPrefix",
        "historyTableName","historyTableSchema",
        "tmpDir","hashFunction"
    ];

    for (let i = 0; i < mandatory.length; i++) {
        const key = mandatory[i];
        if (!config[key]) {
            error(`Config key ${key} is required. Please provide a valid config key.`);
            return false;
        }
    }
    return true;
}


function getDirectoryPath(scriptPath) {
    const lastSlashIndex = scriptPath.lastIndexOf('/');
    return lastSlashIndex !== -1 ? scriptPath.substring(0, lastSlashIndex + 1) : '';
};


module.exports = {
    history: async function(opt, config) {

        if (!validateConfig(config)) {
            return;
        }

        var schemaQuery = str => formatByName(str, {schema: config.historyTableSchema, name: config.historyTableName});

        var exists = (await query(schemaQuery(tableExistsQuery), opt, config)) == 't';
        if (exists) {
            info(JSON.parse(await query(schemaQuery(historyQuery), opt, config)));
        } else {
            error("History table does not exists!");
        }
    },
    migrate: async function(cmd, opt, config) {
        if (!validateConfig(config)) {
            return;
        }
        if (Array.isArray(config.migrationDir)) {
            for (let i = 0; i < config.migrationDir.length; i++) {
                const migrationDir = config.migrationDir[i];
                if (!fs.existsSync(migrationDir)) {
                    error(`Migration directory ${migrationDir} does not exist. Please provide a valid migration directory.`);
                    return;
                }
                if (opt.verbose) {
                    info("Using migration directory: " + migrationDir);
                }
            }
        }
        else {
            var migrationDir = path.join(process.cwd(), config.migrationDir);
            if (!fs.existsSync(migrationDir)) {
                error(`Migration directory ${migrationDir} does not exist. Please provide a valid migration directory.`);
                return;
            }
            if (opt.verbose) {
                info("Using migration directory: " + migrationDir);
            }
        }
    
        var schemaQuery = str => formatByName(str, {schema: config.historyTableSchema, name: config.historyTableName});
    
        var tmpFile = null;
        try
        {
            if (!fs.existsSync(config.tmpDir)) {
                if (opt.verbose) {
                    info("Creating tmp directory: " + config.tmpDir);
                }
                fs.mkdirSync(config.tmpDir);
            } else if (!config.keepMigrationDirHistory) {
                if (opt.verbose) {
                    info("Clearing tmp directory: " + config.tmpDir);
                }
                fs.readdirSync(config.tmpDir).forEach(file => {
                    fs.unlinkSync(path.join(config.tmpDir, file));
                });
            }
    
            var history = [];
            if (!opt.full) {
                var exists = (await query(schemaQuery(tableExistsQuery), opt, config)) == 't';
                if (exists) {
                    history = JSON.parse(await query(schemaQuery(historyQuery), opt, config));
    
                } else {
                    if (opt.verbose) {
                        info("Creating history table...");
                    }
                    var result = await command(formatByName(createHistoryTableScript, {
                        schema: config.historyTableSchema, 
                        name: config.historyTableName, 
                        types: Object.values(migTypes).map(t => `'${t}'`).join(",")
                    }), opt, [], config, true);
                    
                    if (result != 0) {
                        error("Failed to create history table, exiting...");
                        return;
                    }
                }
            }
    
            var repetableHashes = {};
            var versionDict = {};
            history.forEach(h => {
                if (h.type == migTypes.repetable || h.type == migTypes.repetableBefore) {
                    repetableHashes[h.hash + ";" + h.script] = h;
                }
                if (h.type == migTypes.up) {
                    versionDict[h.version] = h;
                }
            });
            var versionKeys = Object.keys(versionDict).map(k => Object({version: k})).sort((a, b) => config.versionSortFunction(a, b, config));

            const migrationDirs = Array.isArray(config.migrationDir) ? config.migrationDir : [config.migrationDir];
            
            const upDirsHash = {};
            const downDirsHash = {};
            const repetableDirsHash = {};
            const repetableBeforeDirsHash = {};
            const beforeDirsHash = {};
            const afterDirsHash = {};
    
            if (config.upDirs && config.upDirs.length > 0) {
                migrationDirs.push(...config.upDirs);
                config.upDirs.forEach(d => upDirsHash[d] = true);
            }
            if (config.downDirs && config.downDirs.length > 0) {
                migrationDirs.push(...config.downDirs);
                config.downDirs.forEach(d => downDirsHash[d] = true);
            }
            if (config.repetableDirs && config.repetableDirs.length > 0) {
                migrationDirs.push(...config.repetableDirs);
                config.repetableDirs.forEach(d => repetableDirsHash[d] = true);
            }
            if (config.repetableBeforeDirs && config.repetableBeforeDirs.length > 0) {
                migrationDirs.push(...config.repetableBeforeDirs);
                config.repetableBeforeDirs.forEach(d => repetableBeforeDirsHash[d] = true);
            }
            if (config.beforeDirs && config.beforeDirs.length > 0) {
                migrationDirs.push(...config.beforeDirs);
                config.beforeDirs.forEach(d => beforeDirsHash[d] = true);
            }
            if (config.afterDirs && config.afterDirs.length > 0) {
                migrationDirs.push(...config.afterDirs);
                config.afterDirs.forEach(d => afterDirsHash[d] = true);
            }
            
            const beforeList = [];
            const repetableBeforeList = [];
            const repetableList = [];
            const upList = [];
            const downList = [];
            const afterList = [];
    
            const upVersions = {};
            const downVersions = {};
    
            const isUp = cmd == "up";
            const isDown = cmd == "down";
    
            const versionUpNames = {};
            const versionDownNames = {};
    
            if (config.recursiveDirs) {
                var migrationDirsTmp = [...migrationDirs];
                for (let i = 0; i < migrationDirsTmp.length; i++) { 
                    const migrationDir = migrationDirsTmp[i];
                    fs.readdirSync(migrationDir, {recursive: true}).forEach(subDir => {
                        const subDirPath = path.join(migrationDir, subDir);
                        if (fs.lstatSync(subDirPath).isDirectory()) {
                            migrationDirs.push(subDirPath);
                        }
                    });
                }
            }
            const hasMultipleDirs = migrationDirs.length > 1;
            var parsedDirs = {};
            var usedNames = {};
            migrationDirs.sort();
            var finalizeList = [];
            for (let i = 0; i < migrationDirs.length; i++) {
                const migrationDir = migrationDirs[i];
                if (!migrationDir) {
                    continue;
                }
                var parsed = migrationDir.replace(/[^a-zA-Z0-9]/g, "");
                if (parsedDirs[parsed]) {
                    continue;
                }
                parsedDirs[parsed] = true;
    
                if (!fs.existsSync(migrationDir) || !fs.lstatSync(migrationDir).isDirectory()) {
                    error(`Migration directory ${migrationDir} does not exist or is not a directory. Please provide a valid migration directory.`);
                    return;
                }
                fs.readdirSync(migrationDir).forEach(fileName => {
                    const filePath = path.join(migrationDir, fileName);
                    if (fs.lstatSync(filePath).isDirectory()) {
                        return;
                    }

                    // if filePath matches config.skipPattern, skip it
                    if (config.skipPattern && filePath.match(config.skipPattern)) {
                        if (opt.verbose) {
                            warning(`Skipping file ${fileName} matching skip pattern ${config.skipPattern}.`);
                        }
                        return;
                    }
    
                    for (let j = 0; j < config.migrationExtensions.length; j++) {
                        const ext = config.migrationExtensions[j].toLowerCase();
                        if (!fileName.toLowerCase().endsWith(ext)) {
                            if (opt.verbose) {
                                warning(`Skipping file ${fileName} with invalid extension. Valid extensions are ${config.migrationExtensions.join(", ")}.`);
                            }
                            return;
                        }
                    }
    
                    if (fileName.indexOf(config.separatorPrefix) == -1 
                        && repetableDirsHash[migrationDir] == false 
                        && repetableBeforeDirsHash[migrationDir] == false
                        && beforeDirsHash[migrationDir] == false
                        && afterDirsHash[migrationDir] == false
                        && upDirsHash[migrationDir] == false
                        && downDirsHash[migrationDir] == false) {
                        warning(`Migration file ${fileName} does not contain separator prefix ${config.separatorPrefix}. Skipping...`);
                        return;
                    }
    
                    let parts = fileName.split(config.separatorPrefix);
                    let prefix = parts[0];
                    let suffix = parts.slice(1).join(config.separatorPrefix);
    
                    let version = null;
                    let name = suffix.split(".").slice(0, -1).join(".").replace(/[^a-zA-Z0-9]/g, " ").trim().replace(/\s+/g, " ");
                    const script = ((hasMultipleDirs ? (migrationDir + "/" + fileName).replace(/\\/g, "/") : fileName).replace(/\/+/g, "/")).replace('./', "");

                    //const topDir = getDirectoryPath(script);
                    //info(topDir);

                    if (prefix.startsWith(config.upPrefix) || prefix.startsWith(config.downPrefix)) {
                        version = prefix.slice(config.upPrefix.length).trim();
                        if (config.migrationDir && config.appendTopDirToVersion) {
                            const dirs = migrationDir.replace(/\\/g, "/").split("/");
                            const topDir = dirs[dirs.length - 1];
                            //const parts = topDir.split(config.appendTopDirToVersionSplitBy);
                            //info(topDir);
                            if (topDir) {
                                if (config.appendTopDirToVersionSplitBy) {
                                    //version = topDir + version;
                                    const topDirSplit = topDir.split(config.appendTopDirToVersionSplitBy);
                                    const part = topDirSplit[config.appendTopDirToVersionPart];
                                    if (part) {
                                        version = part + version;
                                    }
                                }
                                else {
                                    version = topDir + version;
                                }
                            }
                        }
                        name = version + " " + name;
                    }
                    
                    if (usedNames[name]) {
                        let dirParts = migrationDir.replace(/[^a-zA-Z0-9]/g, " ").trim().split(" ");
                        let nameSet = false;
                        for (let i = dirParts.length - 1; i >= 0; i--) {
                            let newName = name + " (" + dirParts.slice(i).join(" ") + ")";
                            if (!usedNames[newName]) {
                                name = newName;
                                nameSet = true;
                                break;
                            }
                        }
                        if (!nameSet) {
                            let count = 1;
                            while(usedNames[name]) {
                                name = name + ` (${count++})`;
                            }
                        }
                    }
                    usedNames[name] = true;
    
                    let type = null;
                    const meta = {};
    
                    //const content = await parseContent(filePath, config, opt);
                    const content = parseContent(filePath, config, opt);
                    const hash = config.hashFunction(content);
    
                    let pushTo = null;
                    
                    if (prefix.startsWith(config.upPrefix) || upDirsHash[migrationDir]) {
                        if (isUp) {
                            if (upVersions[version]) {
                                error(`Migration file ${script} contains duplicate version ${version} already present in ${upVersions[version]}. Exiting...`);
                                process.exit(config.failureExitCode);
                                return;
                            }
                            upVersions[version] = script;
                            type = migTypes.up;
    
                            if (!version) {
                                warning(`Migration file ${migrationDir}/${fileName} does not contain version. Skipping...`);
                                return;
                            }
    
                            if (versionDict[version]) {
                                return;
                            }

                            var lastVersion = versionKeys[versionKeys.length - 1];
                            if (lastVersion && config.versionSortFunction(lastVersion, {version}, config) > 0) {
                                if (!config.runOlderVersions) {
                                    warning(`Migration file ${migrationDir}/${fileName} version is lower than the highest version ${lastVersion.version}. To include this migration set runOlderVersions to true in configuration. Skipping...`);
                                    return;
                                }
                            }

                            var count = versionUpNames[name];
                            count = count ? count + 1 : 1;
                            if (count > 1) {
                                name = name + " (" + count + ")";
                            }
                            versionUpNames[name] = count;
    
                            pushTo = upList;
                        }
    
                    } else if (prefix.startsWith(config.downPrefix) || downDirsHash[migrationDir]) {
                        if (isDown) {
                            if (downVersions[version]) {
                                error(`Migration file ${script} contains duplicate version ${version} already present in ${downVersions[version]}. Exiting...`);
                                process.exit(config.failureExitCode);
                                return;
                            }
                            downVersions[version] = script;
                            type = migTypes.down;
    
                            if (!version) {
                                warning(`Migration file ${migrationDir}/${fileName} does not contain version. Skipping...`);
                                return;
                            }
    
                            if (!versionDict[version]) {
                                return;
                            }
    
                            var count = versionDownNames[name];
                            count = count ? count + 1 : 1;
                            if (count > 1) {
                                name = name + " (" + count + ")";
                            }
                            versionDownNames[name] = count;
    
                            meta.up = versionDict[version];
                            pushTo = downList;
                        }
    
                    } else if (prefix == config.repetablePrefix || repetableDirsHash[migrationDir]) {
                        if (isUp) {
                            type = migTypes.repetable;
    
                            if (repetableHashes[hash + ";" + script]) {
                                return;
                            }
                            pushTo = repetableList;
                        }
                    } else if (prefix == config.repetableBeforePrefix || repetableBeforeDirsHash[migrationDir]) {
                        if (isUp) {
                            type = migTypes.repetableBefore;

                            if (repetableHashes[hash + ";" + script]) {
                                //pushTo = null;
                                return;
                            }
                            pushTo = repetableBeforeList;
                        }
                    } else if (prefix == config.beforePrefix || beforeDirsHash[migrationDir]) {
                        if (isUp) {
                            type = migTypes.before;
                            pushTo = beforeList;
                        }
    
                    } else if (prefix == config.afterPrefix || afterDirsHash[migrationDir]) {
                        if (isUp) {
                            type = migTypes.after;
                            pushTo = afterList;
                        }

                    } else if (prefix == config.finalizePrefix) {
                        finalizeList.push({fileName, filePath: filePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace('./', "").replace('./', "")});
                    } else {
                        if (config.allFilesAreRepetable) {
                            if (isUp) {
                                type = migTypes.repetable;
        
                                if (repetableHashes[hash + ";" + script]) {
                                    return;
                                }
                                pushTo = repetableList;
                                name = fileName.split(".").slice(0, -1).join(".").replace(/[^a-zA-Z0-9]/g, " ").trim().replace(/\s+/g, " ");
                            }
                        } else if (config.warnOnInvalidPrefix) {
                            warning(`Migration file ${fileName} does not contain valid prefix. Skipping. Valied prefixes are '${config.upPrefix}', '${config.downPrefix}', '${config.repetablePrefix}', '${config.repetableBeforePrefix}', '${config.beforePrefix}', '${config.afterPrefix}', '${config.finalizePrefix}' and separator prefix '${config.separatorPrefix}'.`);
                            return;
                        }
                    }
    
                    if (pushTo) {
                        pushTo.push({ name, version, type, script, hash, content, meta });
                    }
                });
            }
    
            afterList.sort((a, b) => config.sortFunction(a, b, config));
            beforeList.sort((a, b) => config.sortFunction(a, b, config));
    
            repetableList.sort((a, b) => config.sortFunction(a, b, config));
            repetableBeforeList.sort((a, b) => config.sortFunction(a, b, config));
    
            upList.sort((a, b) => config.versionSortFunction(a, b, config));
            downList.sort((a, b) => config.versionSortFunction(b, a, config));

            var finalUpList;
            if (config.recursiveDirs && config.dirsOrderedByName) {
                const indexedList = beforeList
                    .concat(repetableBeforeList)
                    .concat(upList)
                    .concat(repetableList)
                    .concat(afterList)
                    .map((item, index) => ({...item, originalIndex: index}));
                finalUpList = indexedList.sort((a, b) => {

                    const pathA = getDirectoryPath(a.script);
                    const pathB = getDirectoryPath(b.script);

                    if (config.dirsNaturalOrder !== true) {
                        if (pathA !== pathB) {
                            return (config.dirsOrderReversed ? -1 : 1) * pathA.localeCompare(pathB);
                        }
                        return a.originalIndex - b.originalIndex;
                    }
                    
                    const aSegments = pathA.split('/');
                    const bSegments = pathB.split('/');
                    
                    const aLength = aSegments.length;
                    const bLength = bSegments.length;
                    const maxLen = Math.max(aLength, bLength);
            
                    for (let i = 0; i < maxLen; i++) {
                        const aSeg = i < aLength ? aSegments[i] : null;
                        const bSeg = i < bLength ? bSegments[i] : null;
            
                        // Check if current segments are directories or files
                        const aIsDir = i < aLength - 1;
                        const bIsDir = i < bLength - 1;
            
                        if (aSeg === null || bSeg === null) {
                            // One path is shorter; handled after loop
                            break;
                        }
            
                        // Compare directories before files at the same level
                        if (aIsDir !== bIsDir) {
                            return (config.dirsOrderReversed ? -1 : 1) * (aIsDir ? -1 : 1);
                        }
            
                        // Compare segment names lexicographically
                        const cmp = aSeg.localeCompare(bSeg);
                        if (cmp !== 0) {
                            return (config.dirsOrderReversed ? -1 : 1) * cmp;
                        }
                    }
            
                    // Handle paths where one is a prefix of the other
                    if (aLength !== bLength) {
                        return (config.dirsOrderReversed ? -1 : 1) * aLength - bLength;
                    }
            
                    // Paths are identical; use original index
                    return a.originalIndex - b.originalIndex;
                });
            } else {
                finalUpList = beforeList.concat(repetableBeforeList).concat(upList).concat(repetableList).concat(afterList);
            }
    
            if (opt.list) {
                if (isUp) {
                    finalUpList.forEach((m, index) => {
                        info({
                            rank: index+1,
                            name: m.name, 
                            version: m.version,
                            type: m.type,
                            script: m.script,
                            hash: m.hash
                        })
                    });

                    if (finalizeList && finalizeList.length) {
                        info("");
                        warning("Finalize scripts:");
                        for (let item of finalizeList) {
                            info(item);
                        }
                    }
                    return;
                }
                if (isDown) {
                    downList.forEach((m, index) => {
                        info({
                            rank: index+1,
                            name: m.name, 
                            version: m.version,
                            type: m.type,
                            script: m.script,
                            hash: m.hash
                        })
                    });

                    if (finalizeList && finalizeList.length) {
                        info("");
                        info("Finalize scripts:");
                        for (let item of finalizeList) {
                            info(item);
                        }
                    }
                }
            }
    
            if (isUp) {
                if (beforeList.length == 0 && repetableBeforeList.length == 0 && upList.length == 0 && repetableList.length == 0 && afterList.length == 0) {
                    warning("Nothing to migrate.");
                    await finalize(finalizeList, config, opt);
                    return;
                }
            } else if (isDown) {
                if (downList.length) {
                    warning("Nothing to migrate.");
                    await finalize(finalizeList, config, opt);
                    return;
                }
            }
    
            const date = new Date();
            const ident = date.toISOString().replace(/[-:.ZT]/g, "");
            tmpFile = path.join(config.tmpDir, `migration_${ident}.sql`);
            if (opt.verbose) {
                info("Creating migration file: " + tmpFile);
            }
            if (fs.existsSync(tmpFile)) {
                fs.unlinkSync(tmpFile);
            }
            const line = l => fs.appendFileSync(tmpFile, l + "\n", { encoding: "utf8", flag: "a" });
    
            let index = 0;
            const addMigration = list => list.forEach(m => {
                index++;
                const cleanUp = m.type == migTypes.down ? 
                    `delete from ${config.historyTableSchema}.${config.historyTableName} where name = '${m.meta.up.name}' and type = '${migTypes.up}';` : 
                    formatByName(upsertHistorySql(config), {  
                        historySchema: config.historyTableSchema, 
                        historyName: config.historyTableName,
                        name: m.name,
                        type: m.type,
                        version: m.version ? `'${m.version}'` : "null",
                        script: m.script,
                        hash: m.hash
                    });
                
                    line(`--
-- Migration ${index}
-- Script: ${m.script}
-- Type: ${m.type}
--`);
                if (config.useProceduralScript) {
                    line(`raise info 'Running migration %: %. Script file: %', ${index}, '${m.name}', '${m.script}';
___clock = clock_timestamp();`);
                    } else {

                        line(`do 'begin raise info ''Running migration %: %. Script file: %'', ${index}, ''${m.name}'', ''${m.script}''; end;';
select set_config('migration.clock', clock_timestamp()::text, true);`);

                    }
                line(`-- Migration ${index} start
${m.content}
-- Migration ${index} end
${cleanUp}
`);
            });
    


            if (config.useProceduralScript) {
                line(`do
$migration_${ident}$
declare ___clock timestamp with time zone;
begin
--
-- Migration file generated by pgmigrations
-- Date: ${date.toISOString()}
--

`);
            } else {
                line(`begin;
--
-- Migration file generated by pgmigrations
-- Date: ${date.toISOString()}
--

`);
            }
    
            if (beforeList.length == 0 && 
                repetableBeforeList.length == 0 && 
                upList.length == 0 && downList.length == 0 && repetableList.length == 0 && afterList.length == 0) {
            }
    
            if (isUp) {
                // addMigration(beforeList);
                // addMigration(repetableBeforeList);
                // addMigration(upList);
                // addMigration(repetableList);
                // addMigration(afterList);
                addMigration(finalUpList);
            } else if (isDown) {
                addMigration(downList);
            }
    
            line(`-- Update ranks
${schemaQuery(`update {schema}.{name}
set rank = t.rank
from (
    select name, type, row_number() over (order by 
        case 
            when type = 'B' then 1
            when type = 'P' then 2
            when type = 'U' then 3
            when type = 'R' then 4
            when type = 'A' then 5
            else 6
        end,
        version,
        name) as rank
    from {schema}.{name}
    ) as t
where {schema}.{name}.name = t.name and {schema}.{name}.type = t.type;`)}
`);
    
            if (opt.dry) {
                if (config.useProceduralScript) {
                line(`raise notice 'Rolling back migration changes...';';
rollback;`);
                } else {
                    line(`do 'begin raise notice ''Rolling back migration changes...''; end;';
rollback;`);
                }
            }
            
            if (config.useProceduralScript) {
            line(`end;
$migration_${ident}$;`);
            } else {
                if (!opt.dry) {
                    line(`end;`);
                }
            }
    
        if (opt.dump) {
            info("\n" + fs.readFileSync(tmpFile, { encoding: "utf8"}));
        } else {
            info("Running migration...");
            try {

                var result = await run({
                    command: config.psql,
                    config: config,
                    file: tmpFile,
                    verbose: opt.verbose,
                    skipErrorDetails: true,
                    //additionalArgs: ["-v", "VERBOSITY=terse", "-v", "ON_ERROR_STOP=1"],
                }, true);
                if (result != 0) {
                    error("Migration failed with exit code " + result + ". Changes have been rolled back.");
                    if (tmpFile && fs.existsSync(tmpFile)) {
                        warning("Migration file: " + tmpFile);
                    }
                    process.exit(config.failureExitCode);
                    return;
                } else {
                    warning("Migration completed successfully.");
                }

            } catch (e) {
                error("Migration failed. Changes have been rolled back.");
                if (tmpFile && fs.existsSync(tmpFile)) {
                    warning("Migration file: " + tmpFile);
                }
                process.exit(config.failureExitCode);
                return;
            }

            await finalize(finalizeList, config, opt);
        }
    
        } catch (e) {
            error(e);
            //error("Migration failed. Changes have been rolled back.");
            if (tmpFile && fs.existsSync(tmpFile)) {
                warning("Migration file: " + tmpFile);
            }
            process.exit(config.failureExitCode);
            return;
        }
    }
}

async function finalize(finalizeList, config, opt) {
    if (finalizeList && finalizeList.length) {
        for (let item of finalizeList) {
            info(item.fileName + " ...");
            var result = await run({
                command: config.psql,
                config: config,
                file: item.filePath,
                verbose: opt.verbose,
                skipErrorDetails: false,
                //additionalArgs: ["-v", "VERBOSITY=terse", "-v", "ON_ERROR_STOP=1"],
            }, true);
            if (result != 0) {
                error("Finalize failed with exit code " + result + "., File: ", file);
            }
        }
        warning("Finalize completed successfully.");
    }
}

