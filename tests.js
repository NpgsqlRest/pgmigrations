const { warning, info, error, passed, failed } = require("./log.js");
const fs = require("fs");
const path = require("path");
const { run } = require("./runner.js");

module.exports = async function(opt, config) {

    var testList = [];
    const migrationDirs = Array.isArray(config.migrationDir) ? config.migrationDir : [config.migrationDir];
    for (let i = 0; i < migrationDirs.length; i++) {
        const migrationDir = migrationDirs[i];
        if (!migrationDir) {
            continue;
        }
        if (!fs.existsSync(migrationDir) || !fs.lstatSync(migrationDir).isDirectory()) {
            error(`Test directory ${migrationDir} does not exist or is not a directory. Please provide a valid test directory.`);
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
            testList.push({fileName, filePath: filePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace('./', "").replace('./', "")});
        });
    }

    if (!testList.length) {
        warning("Nothing to test.");
    }

    if (opt.list) {
        info("");
        warning("Test scripts:");
        for (let item of testList) {
            info(item);
        }
        return;
    }

    let failedCount = 0;
    let passedCount = 0;
    let label = "Total " + testList.length.toString() + " tests";
    console.time(label);
    await Promise.all(testList.map(async (test) => {
        
        let testInfo = test.fileName;
        let result = 0;

        try {
            result = await run({
                command: config.psql,
                config: config,
                file: test.filePath,
                verbose: opt.verbose,
                skipErrorDetails: false,
                //additionalArgs: ["-v", "VERBOSITY=terse", "-v", "ON_ERROR_STOP=1"],
            }, true);
        } catch (e) {
            result = -1;
        }

        if (result != 0) {
            failed(testInfo);
            failedCount++;
        } else {
            passed(testInfo);
            passedCount++;
        }
    }));

    info("");
    passed(passedCount.toString());
    if (failedCount > 0) {
        failed(failedCount.toString());
    }
    console.timeEnd(label);

    if (failedCount > 0) {
        // exit process with non-zero status
        process.exit(config.failureExitCode);
    }
}

