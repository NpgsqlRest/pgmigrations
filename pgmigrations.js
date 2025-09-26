#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const mainConfig = require("./config.js");
const { error, warning, info, sections } = require("./log.js");
const { command: commandRunner, schema, psql } = require("./runner.js");
const {migrate, history} = require("./migration.js");
const tests = require("./tests.js");

var defaultconfigFile = "./db.js";
var defaultconfigFile2 = "./pgmigrations.js";

var args = process.argv.slice(2);
//var args = ["test", "--config=test-cfg.js"];
var cmd = args[0];
var userConfigs = [defaultconfigFile, defaultconfigFile2];

const envRegex = /\$\{([^}]+)\}/g;

info("v"+require("./package.json").version);

function buildConfig(opt) {
    for (var i = 0; i < userConfigs.length; i++) {
        var configFile = path.join(process.cwd(), userConfigs[i]);
        if (fs.existsSync(configFile) && fs.lstatSync(configFile).isFile()) {
            if (opt.verbose) {
                info("Using config file: " + configFile);
            }
            var config = require(configFile);

            for (var key in config) {
                if (mainConfig[key] === undefined) {
                    error("Unknown config key: " + key +". Please provide a valid config key.");
                    return {};
                }
                mainConfig[key] = config[key];
            }

        } else if (userConfigs[i] !== defaultconfigFile && userConfigs[i] !== defaultconfigFile2) {
            warning("Config file not found: " + configFile + ". Please provide a valid config file.");
        }
    }

    if (mainConfig.env) {
        if (typeof mainConfig.env === "string") {
            if (!fs.existsSync(path.resolve(mainConfig.env))) {
                warning("Env file not found: " + mainConfig.env + ". Please provide a valid env file.");
            }
            require('dotenv').config({ 
                path: path.resolve(mainConfig.env)
            });
        } else {
            require('dotenv').config();
        }
    }

    for (var key of Object.keys(mainConfig)) {
        var value = mainConfig[key];
        if (typeof value === "string") {
            value = value.replace(envRegex, function(match, regkey) {
                return process.env[regkey] !== undefined ? process.env[regkey] : match;
            });
            mainConfig[key] = value;
        }
    }

    return mainConfig || {};
}

if (!cmd) {
    error("Command is required. Please provide a valid command.");
    cmd = "help";
}

cmd = cmd.toLowerCase();

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {

    info('Usage:');
    info('pgmigrations [command] [switches]');
    info('\nCommands:');
    
    sections([  
        {key: "up", value: "Run migrations migrations in order: before, before repeatable, up, repeatable, after. Optional switches: --list, --dry, --full, --dump."},
        {key: "down", value: "Run only down migrations. Optional switches: --list, --dry, --full, --dump."},
        {key: "history", value: "info the current migration schema history."},
        {key: "run | exec", value: "Run a command or a script file or script directory with psql. Command text or a script file is required as the second argument. Any additional arguments will be passed to a psql command."},
        {key: "dump | schema", value: "Run pg_dump command with --schema-only --encoding=UTF8 swtiches on (plus schemaDumpAdditionalArgs from the config). Any additional arguments will be passed to pg_dump command."},
        {key: "psql", value: "Run arbitrary psql command or open psql shell. Any additional arguments will be passed to a psql."},
        {key: "test", value: "Run database tests."},
        {key: "config", value: "info the current configuration."},
    ], 16);
    
    info('\nSwitches:');

    sections([
        {key: "-h, --help", value: "Show help"},
        {key: "--list", value: "List available migrations in this direction (up or down) or list available database tests."},
        {key: "--dry", value: "Run in the migrations dry run mode on database in this direction (up or down). No changes will be made to the database (rollbacks changes)."},
        {key: "--full", value: "Executes all migrations in this direction (up or down). Schema history will be ignored."},
        {key: "--dump", value: "Dump the SQL for the migration to the console instead of executing it."},
        {key: "--verbose", value: "Run in verbose mode. This switch applies to all commands. Default is false."}
    ], 16);

    info('\nConfigurations files:');
    sections([
        {key: '', value: './db.js or ./pgmigrations.js from the current dir is the default configuration file. It will be ignored if not found.'},
        {key: '--config=[file]', value: 'Set the custom config file or multiple files (multiple --config switches). Config files are merged in the order they are provided.'}
    ], 16);

    info("");
    return;
}

const options = args.slice(1);
let verbose = false;

if (cmd == "up" || cmd == "down") {
    let list = false;
    let dry = false;
    let full = false;
    let dump = false;

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--list") {
                list = true;
            } else if (opt == "--dry") {
                dry = true;
            } else if (opt == "--full") {
                full = true;
            } else if (opt == "--dump") {
                dump = true;
            } else if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                error("Unknown option: " + opt + ". Please provide a valid option");
                return;
            }
        }
    }

    if (list && (dry || dump)) {
        error("List option is not allowed with dry or dump. Please provide a valid option.");
        return;
    }

    const opt = {list, dry, dump, full, verbose};
    const config = buildConfig(opt);
    opt.verbose = opt.verbose || config.verbose;
    migrate(cmd, opt, config);

} else if (cmd == "run" || cmd == "exec") {

    let command;
    let additionalArgs = [];

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                additionalArgs.push(opt);
            }
        }
        else {
            if (!command) {
                command = opt;
            } else {
                additionalArgs.push(opt);
            }
        }
    }

    if (!command && additionalArgs.indexOf("--help") === -1) {
        error("Command is required. Please provide a command to run.");
        return;
    }

    const opt = {verbose};
    const config = buildConfig(opt);
    opt.verbose = opt.verbose || config.verbose;
    commandRunner(command, opt, additionalArgs, config);

} else if (cmd == "dump" || cmd == "schema") {

    let additionalArgs = [];

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                additionalArgs.push(opt);
            }
        }
        else {
            additionalArgs.push(opt);
        }
    }

    const opt = {verbose};
    const config = buildConfig(opt);
    opt.verbose = opt.verbose || config.verbose;
    schema(opt, additionalArgs, config);

} else if (cmd == "psql") {

    let additionalArgs = [];

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                additionalArgs.push(opt);
            }
        }
        else {
            additionalArgs.push(opt);
        }
    }

    const opt = {verbose};
    const config = buildConfig(opt);
    opt.verbose = opt.verbose || config.verbose;
    psql(opt, additionalArgs, config);

} else if (cmd == "test") {

    let list = false;

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--list") {
                list = true;
            } else if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                error("Unknown option: " + opt + ". Please provide a valid option");
                return;
            }
        }
    }

    const opt = {list, verbose};
    const config = buildConfig(opt);
    opt.verbose = opt.verbose || config.verbose;
    tests(opt, config);

} else if (cmd == "config") {

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                error("Unknown option: " + opt + ". Please provide a valid option");
                return;
            }
        }
    }

    const config = buildConfig({verbose});
    info(config);

} else if (cmd == "history") {

    for (let i = 0; i < options.length; i++) {
        let opt = options[i];

        if (opt.startsWith("-")) {
            if (opt == "--verbose") {
                verbose = true;
            } else if (opt.startsWith("--config")) {
                let parts = opt.split("=");
                if (parts.length <= 1) {
                    error("Config file is required. Please provide a valid config file.");
                    return;
                }
                userConfigs.push(parts[1]);
            } else {
                error("Unknown option: " + opt + ". Please provide a valid option");
                return;
            }
        }
    }

    const config = buildConfig({verbose});
    history({verbose}, config);

} else {

    error("Unknown command: " + cmd + ". Please provide a valid command.");
    return;
}


