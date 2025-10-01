const crypto = require('crypto');
const os = require('os');
const path = require('path');

module.exports = {
    host: "",
    port: "",
    dbname: "",
    username: "",
    password: "",
    
    psql: "psql",
    pgdump: "pg_dump",
    schemaDumpAdditionalArgs: ["--no-owner", "--no-acl"],
    verbose: false,
    env: true,

    migrationDir: "",
    
    upDirs: [],
    downDirs: [],
    repeatableDirs: [],
    repeatableBeforeDirs: [],
    beforeDirs: [],
    afterDirs: [],

    upPrefix: "V",
    downPrefix: "U",
    repeatablePrefix: "R",
    repeatableBeforePrefix: "_R",
    beforePrefix: "_B",
    afterPrefix: "_A",
    separatorPrefix: "__",
    finalizePrefix: "TEST",
    allFilesArerepeatable: false,
    repeatableByScriptPath: true,
    migrationExtensions: [".sql"],
    recursiveDirs: false,
    dirsOrderedByName: true,
    dirsNaturalOrder: true,
    dirsOrderReversed: false,
    appendTopDirToVersion: false,
    appendTopDirToVersionSplitBy: "__",
    appendTopDirToVersionPart: 0,
    keepMigrationDirHistory: false,
    tmpDir: path.join(os.tmpdir(), "___pgmigrations"),
    historyTableName: "schema_history",
    historyTableSchema: "pgmigrations",
    skipPattern: "scrap",
    useProceduralScript: false,
    warnOnInvalidPrefix: true,
    parseScriptTags: true,
    parseEnvVars: true,
    runOlderVersions: false,
    migrationAdditionalArgs: [],
    hashFunction: function(data) {
        const hash = crypto.createHash('sha1');
        hash.update(data);
        return hash.digest('hex');
    },
    sortByPath: true,
    sortFunction: (a, b, config) => config.sortByPath ? a.script.localeCompare(b.script, "en") : a.name.localeCompare(b.name, "en"),
    versionSortFunction: (a, b, config) => a.version.localeCompare(b.version, "en", {numeric: true}),

    failureExitCode: -1,

    testDir: "",

    // todo
    createTestTemplateDb: false,
    createTestTemplateDbForEachTest: false,
    testTemplateDbName: "{db}_test_{timestamp}_{index}", // {db} = original db name, {timestamp} = current timestamp, {index} = index of the test (zero is master)
    testTemplateDbOptions: "", // additional options when creating the test template database 
}
