const fs = require("fs");
const cp = require("child_process");
const {info, error, warning, logDataMsg} = require("./log.js");
const path = require("path");

const migrationErrorTreshold = 1;

function run(options, stdErrOnly) {
    var args = [];

    if (!options.command) {
        error("Command is required.");
        return;
    }
    
    var cmd = options.config[options.command] || options.command;

    if (options.config.host) {
        args.push(`--host=${options.config.host}`);
    }
    if (options.config.port) {
        args.push(`--port=${options.config.port}`);
    }
    if (options.config.dbname) {
        args.push(`--dbname=${options.config.dbname}`);
    }
    if (options.config.username) {
        args.push(`--username=${options.config.username}`);
    }

    if (options.returnBuffer) {
        args.push("--tuples-only", "--no-align");
    }

    if (options.dump) {
        args.push("--schema-only");
        args.push("--encoding=UTF8");
        if (options.config.schemaDumpAdditionalArgs && options.config.schemaDumpAdditionalArgs.length) {
            args.push(...options.config.schemaDumpAdditionalArgs);
        }
    }

    if (options.sql || options.file) {
        args.push("--echo-errors");
        if (options.file) {
            args.push("--file");
            args.push(options.file);
        } else {
            args.push("--command");
            args.push(options.sql);
        }
    }

    if (options.additionalArgs && options.additionalArgs.length) {
        if (options.additionalArgs.indexOf("--help") > -1) {
            args = ["--help"];
        } else {
            args.push(...options.additionalArgs);
        }
    }

    if (options.verbose) {
        //const formattedArgs = args.map(a => a.replace(/\s+/g, ' ').trim()).map(a => a.indexOf(" ") > - 1 ? '"' + a + '"' : a).join(" ").trim();
        //console.info(`${cmd} ${formattedArgs}`);
        console.info(`${cmd} ${args.join(" ")}`);
    }

    var prefix = cmd + ":";
    var errorCount = 0;
    var stdErrOnlyErrCount = 0;

    const message = (msg) => {
        if (!msg || msg == "DO") {
            return;
        }
        var lines = msg.split("\n");
        //var fromError = -1;
        for (let i = 0; i < lines.length; i++) {
            var line = lines[i];
            var lower = line.toLowerCase();
            if (lower.indexOf("error:") > -1 || lower.indexOf("fatal:") > -1 || lower.indexOf("panic:") > -1) {
                error(line);
                errorCount++;
                options.hasError = true;
                fromError = 0;
            } else if (lower.indexOf("warning:") > -1) {
                warning(line);
            } else {
                info(line);
            }
        }
    };

    return new Promise((resolve, reject) => {
        let stdoutBuffer = "";
        let stderrBuffer = "";

        var spawnOptions = {
            env: {...process.env}
        };
        if (options.inherit) {
            spawnOptions.stdio = 'inherit';
        }
        if (options.config.password) {
            spawnOptions.env.PGPASSWORD = options.config.password;
        }
        options.hasError = false;
        const child = cp.spawn(cmd, args, spawnOptions);
        if (!options.inherit) {
            if (!stdErrOnly) {
                child.stdout.on("data", data => {
                    if (options.returnBuffer) {
                        stdoutBuffer += data.toString().trim();
                    }
                    else if (data) {
                        stdoutBuffer += data;
                        let index = stdoutBuffer.indexOf(prefix);
                        while (index !== -1) {
                            const msg = stdoutBuffer.slice(0, index).trim();
                            if (msg && !options.muted && (!migrationErrorTreshold || errorCount < migrationErrorTreshold)) {
                                message(msg);
                            }
                            stdoutBuffer = stdoutBuffer.slice(index + prefix.length);
                            index = stdoutBuffer.indexOf(prefix);
                        }
                    }
                });
            }

            child.stderr.on("data", data => {
                if (data) {
                    if (stdErrOnly) {
                        var msg = data.toString().trim();
                        if (msg && !options.muted && (!migrationErrorTreshold || errorCount < migrationErrorTreshold)) {

                            if (msg.indexOf(": ERROR: ") > -1) {
                                stdErrOnlyErrCount++;
                                if (stdErrOnlyErrCount > 1) {
                                    errorCount++;
                                    options.hasError = true;
                                    fromError = 0;
                                    return;
                                }
                                logDataMsg(msg);
                            } else {
                                logDataMsg(msg);
                            }
                        }
                    } else {
                        stderrBuffer += data;
                        let index = stderrBuffer.indexOf(prefix);
                        while (index !== -1) {
                            const msg = stderrBuffer.slice(0, index).trim();
                            if (msg && !options.muted && (!migrationErrorTreshold || errorCount < migrationErrorTreshold)) {
                                message(msg);
                            }
                            stderrBuffer = stderrBuffer.slice(index + prefix.length);
                            index = stderrBuffer.indexOf(prefix);
                        }
                        // if (errorCount > 3) {
                        //     child.kill(); // kill the process if there are more than one errors
                        // }
                    }
                }
            });
            child.on("exit", code => {
                if (options.returnBuffer) {
                    if (code === 0) {
                        resolve(stdoutBuffer.trim());
                    } else {
                        reject(stderrBuffer.trim());
                    }
                    
                } else if (!options.muted) {
                    if (stdoutBuffer) {
                        const msg = stdoutBuffer.trim();
                        if (msg && (!migrationErrorTreshold || errorCount < migrationErrorTreshold)) {
                            message(msg);
                        }
                    }
                    if (stderrBuffer) {
                        const msg = stderrBuffer.trim();
                        if (msg && !options.skipErrorDetails && (!migrationErrorTreshold || errorCount < migrationErrorTreshold)) {
                            message(msg);
                        }
                    }
                    if (code !== 0) {
                        reject(code);
                    } else {
                        if (options.hasError || stdErrOnlyErrCount > 0) {
                            reject(code);
                        } else {
                            resolve(code);
                        }
                    }
                } else {
                    resolve({
                        stdout: stdoutBuffer.trim(),
                        stderr: stderrBuffer.trim(),
                        code
                    });
                }
            });
        }
    });
}

function command(command, opt, additionalArgs, config, isCommand = false, muted = false) {
    var fileExists = false;
    var isDir = false;
    if (!isCommand) {
        isDir = (fs.existsSync(command) && fs.lstatSync(command).isDirectory());
        if (isDir) {
            var files = fs.readdirSync(command, {recursive: true});
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                if (file.endsWith(".sql")) {
                    file = path.join(command, file);
                    info(file);
                    run({
                        command: config.psql,
                        config: config,
                        sql: undefined,
                        file: file,
                        dump: false,
                        additionalArgs: additionalArgs,
                        verbose: opt.verbose,
                        inherit: false,
                        returnBuffer: false,
                        muted: muted
                    });
                }
            }
            return;
        }
    }

    if (!isCommand) {
        fileExists = (fs.existsSync(command) && fs.lstatSync(command).isFile());
    }
    return run({
        command: config.psql,
        config: config,
        sql: fileExists ? undefined : command,
        file: fileExists ? command : undefined,
        dump: false,
        additionalArgs: additionalArgs,
        verbose: opt.verbose,
        inherit: false,
        returnBuffer: false,
        muted: muted
    })
}

function schema(opt, additionalArgs, config) {
    return run({
        command: "pgdump",
        config: config,
        sql: false,
        file: false,
        dump: true,
        additionalArgs: additionalArgs,
        verbose: opt.verbose,
        inherit: false,
        returnBuffer: false
    })
}

function query(sql, opt, config) {
    return run({
        command: "psql",
        config: config,
        sql: sql,
        file: false,
        dump: false,
        additionalArgs: [],
        verbose: opt.verbose,
        inherit: false,
        returnBuffer: true
    })
}

function psql(opt, additionalArgs, config) {
    return run({
        command: "psql",
        config: config,
        sql: false,
        file: false,
        dump: false,
        additionalArgs: additionalArgs,
        verbose: opt.verbose,
        inherit: true,
        returnBuffer: false
    })
}

module.exports = {command, schema, query, psql, run}
