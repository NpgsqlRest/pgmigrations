# PgMigrations

![npm version](https://badge.fury.io/js/pgmigrations.svg)
![License](https://img.shields.io/badge/license-MIT-green)
![GitHub Stars](https://img.shields.io/github/stars/vb-consulting/pgmigrations?style=social)
![GitHub Forks](https://img.shields.io/github/forks/vb-consulting/pgmigrations?style=social)

Lightweight, Zero-Dependency, PostgreSQL Tool for Node.js and NPM. You can:

- Run Migrations Up or Down (Repeatable, Version, Before or After).
- Run Arbitrary `psql` Commands by using your Project Configuration.
- Create Database Schema Dumps by using your Project Configuration.
- Run PostgreSQL Database Unit Tests in Functions or Procedures.

Use the `pgmigrations` command to manage migrations and run database commands:

```console
> npx pgmigrations --help
Usage:
 pgmigrations [command] [switches]

Commands:
up               Run migrations migrations in order: before, before repeatable, up, repeatable, after. Optional switches: --list, --dry, --full, --dump. 
down             Run only down migrations. Optional switches: --list, --dry, --full, --dump. 
history          console.log the current migration schema history.
run | exec       Run a command or a script file or script directory with psql. Command text or a script file is required as the second argument. Any additional arguments will be passed to a psql command.
dump | schema    Run pg_dump command with --schema-only --encoding=UTF8 swtiches on (plus schemaDumpAdditionalArgs from the config). Any additional arguments will be passed to pg_dump command. 
psql             Run arbitrary psql command or open psql shell. Any additional arguments will be passed to a psql. 
test             Run database tests. 
config           console.log the current configuration. 

Switches:
-h, --help       Show help 
--list           List available migrations in this direction (up or down) or list available database tests. 
--dry            Run in the migrations dry run mode on database in this direction (up or down). No changes will be made to the database (rollbacks changes). 
--full           Executes all migrations in this direction (up or down). Schema history will be ignored.
--dump           Dump the SQL for the migration to the console instead of executing it.
--verbose        Run in verbose mode. This switch applies to all commands. Default is false.

Configurations files:
                 ./db.js from the current dir is the default configuration file. It will be ignored if not found.
--config=[file]  Set the custom config file or multiple files (multiple --config switches). Config files are merged in the order they are provided.
```

Examples:

- Execute a query:
  
```console
> npx pgmigrations run "select * from city" 
```

- Execute a script:
  
```console
> npx pgmigrations run ./script1.sql
```

- Execute a list of sql files in a dir:

```console
> npx pgmigrations run ./dir
```

- List all tables
  
```console
> npx pgmigrations run \dt
```

- Display psql help
  
```console
> npx pgmigrations run --help
```

- Enter the psql interactive mode

```console
> npx pgmigrations psql
```

- Display database schema to console

```console
> npx pgmigrations dump
```

- Write database schema to file

```console
> npx pgmigrations dump --file schema.sql
```

- List all available migrations

```console
> npx pgmigrations up --list
```

- Run all UP migrations

```console
> npx pgmigrations up
```

- Run database tests

```console
> npx pgmigrations test
```

Etc.

Notes:

This tool spawns `psql` or `pg_dump` external processes to execute database commands. That means, that PostgreSQL client tools must be installed on the system to be able to use this package. PostgreSQL client tools are distributed with the default installation so most likely you already have them pre-installed.

If you don't, there is an option to install client tools only:
- On Linux systems, there is a `postgresql-client` package, the apt installation would be then: `$ apt-get install -y postgresql-client` for the latest version.
- On Windows systems, there is an option to install client tools only in the official installer.

The `db` tool from this package will pass your configuration to the PostgreSQL tools to be able to manage the database.

## Migration Naming Convention

### Versioned Migrations

`[prefix][version][separator][description][suffix]`

Versioned migrations run once per version number in order of the versions.

Versioned migrations can be:

1) Version (version up).
2) Undo (version down).

`V001__my_migration.sql`

`U002__undo_my_migration.sql`

- `V` is a prefix for migration up. This version migration. Prefix is configurable.
- `U` is a prefix for migration down. This undo migration. Prefix is configurable.
- `002` is version info or the version number but it can be any text or number.
- `__` is a separator. Separator is configurable.
- `my_migration` and `undo_my_migration` are migration descriptions. This goes to the migration table as the description without underscores.
- `.sql` is the migration suffix. This goes to the migration table as the type with the removed dot and in uppercase.

### Repeatable Migrations

`[prefix][separator][description][suffix]`

Repeatable migrations can be:

1) Repeatable migration: executed only once per file content. This migration will be executed only if the content is changed.
2) Repeatable before: as the normal repeatable, only run before version migration.
3) Before and after migrations. Migrations are executed always regardless of content.

Examples:

`R__my_migration.sql`

`_R__my_migration.sql`

`_A__my_migration.sql`

`_B__my_migration.sql`


- `R` is a prefix for repeatable migration. Prefix is configurable.
- `_R` is a prefix for repeatable before migration. Prefix is configurable.
- `_B` is a prefix for before migration. Prefix is configurable.
- `_A` is a prefix for before migration. Prefix is configurable.
- `__` is a separator. Separator is configurable.
- `my_migration` and `undo_my_migration` are migration descriptions. This goes to the migration table as the description without underscores.
- `.sql` is the migration suffix. This goes to the migration table as the type with the removed dot and in uppercase.

### Finalize Migrations

Finalize migrations have defualt prefix `TEST`. 
Finalize migrations will always be executed as a separate files, not part of of the migration transaction.

This is convinient place to keep TEST scripts.

## Migration Order

1) Before Migrations
2) Repeatable Before Migrations
3) Repeatable Migrations
4) Versioned Migrations
5) After Migrations

## Configuration

The tool will try to read the default configuration file from the running location:  `db.js`. 

Additional configuration files can be loaded with a command line switch `--config=[file]`. They will be loaded and merged in the order they appear, while the default configuration `db.js` is always first (if it exists).

Example of the configuration file:

```js
module.exports = {
    host: "localhost",
    port: "5432",
    dbname: "dvdrental",
    username: "postgres",
    password: "postgres"
}
```

Any key in this configuration will override the default values listed below.

### Server Connection

Optional connection parameters such as `host`, `port`, `dbname`, `username` and `passowrd`.

If connection parameters are not set, the PostgreSQL client tools will try to get them from the environment variables, so these parameters can be set in the environment. 

See the [documentation](https://www.postgresql.org/docs/current/libpq-envars.html) for more information.

Alternatively, they can be set from the `.ENV` file, if the `env` option is used.

### Environment

#### psql

Sets the name of the `psql` command executable. The default is `psql`.

If the correct command executable is not in the search path you may have to set the right path manually with this configuration:

- For Linux systems that would be: `/usr/lib/postgresql/{major_version}/bin/psql` 
- For Windows systems that would be: `C:\Program Files\PostgreSQL\{major_version}\bin\psql.exe`

#### pgdump

Sets the name of the `pg_dump` command executable. The default is `pg_dump`.

If the correct command executable is not in the search path you may have to set the right path manually with this configuration:

- For Linux systems that would be: `/usr/lib/postgresql/{major_version}/bin/pg_dump` 
- For Windows systems that would be: `C:\Program Files\PostgreSQL\{major_version}\bin\pg_dump.exe`

#### schemaDumpAdditionalArgs

Additional arguments for the dump schema command that will added by default when dumping the schema. The default value is `["--no-owner", "--no-acl"]` (skip the object owners and the access control list). This value, when set, is expected to be an array of strings.

#### verbose

Set to true to log additional information, including all commands issued to client tools. The default is false. This switch can also be set from the command line.

#### env

- Set to true to load the enviorment file from `.env` by default.
- Set to string value to load the enviorment file from the string value.
- Set to false to ignore enviorment file.
- Default is true.

### Migrations

#### migrationDir

Relative directory name where the migration files are located. This value can be a string or array of strings for the multiple directory support.

The default value is not set (empty string). This value needs to be set for every migration project.

#### upDirs

List of directories for versioned UP migrations. Prefix and version number is mandatory.

#### downDirs

List of directories for versioned DOWN migrations. Prefix and version number is mandatory.

#### repetableDirs

List of directories for versioned REPETABLE migrations. Prefix is mandatory.

#### repetableBeforeDirs

List of directories for versioned REPETABLE BEFORE migrations. Prefix is mandatory.

#### beforeDirs

List of directories for versioned BEFORE migrations. Prefix is mandatory.

#### afterDirs

List of directories for versioned AFTER migrations. Prefix is mandatory.

#### keepMigrationDirHistory

Migration scripts are created with a unique name in a temporary directory. Set this value to true to never delete old migration files in a temporary directory. The default value is false, temporary directory is emptied before the start of every migration.

#### upPrefix

Up version migration type prefix. The default is `V` (V for version).

#### downPrefix

Down version migration type prefix. The default is `U` (U for undo).

#### repetablePrefix

Repeatable migration type prefix. The default is `R` (R for repeatable).

#### repetableBeforePrefix

Repeatable before migration type prefix. The default is `_R` (R for repeatable).

#### beforePrefix

Before migration type prefix. The default is `B`.

#### afterPrefix

The after migration type prefix. The default is `A`.

#### separatorPrefix

Separator prefix. The default value is `__`

### repetableByScriptPath

True or false. When true, repetable scripts are identified and by full script path, including directory and full file name. When false, repetable scripts are identified by script name (file name without prefix, separator, extension and path). Default it true.

#### migrationExtensions: [".sql"],

An array of file extensions that will be considered as the migration file. The default is `[".sql"]`.

#### allFilesAreRepetable

All files that don't have valid prefix are repetable migrations.

#### recursiveDirs

Search recursively trough migration subdirectories. The default is false.

#### dirsOrderedByName

When `recursiveDirs` is true, order the migrations based on the directory first and second based on migration type. Default is true.

#### dirsNaturalOrder

When `dirsOrderedByName` is true, order directories same as Visual Studio Code Explorer would (natural order), For example:

```
backend/auth/file1.sql
backend/auth/file2.sql
backend/schema/subdir/file1.sql
backend/schema/file1.sql
backend/file1.sql
```

Defualt is true.

#### dirsOrderReversed

When `dirsOrderedByName` is true, this will reverse order of directories. Defualt is false.

#### appendTopDirToVersion

If `migrationDir` is true and versioned migration - add the top level directory name to version number,

Default is false.

#### appendTopDirToVersionSplitBy

If `migrationDir` is true and versioned migration:
split the top level directory name by this string and the index `appendTopDirToVersionPart` to version number.

Default is "__".

#### appendTopDirToVersionPart

If `migrationDir` is true and versioned migration:
split the top level directory name by this string and the index `appendTopDirToVersionPart` to version number.

Default is 0.

#### tmpDir

Temporary directory for migration scripts. The Default value is your OS temp dir plus  `./___pgmigrations`.

#### historyTableSchema

Schema name for the history table. If this schema doesn't exist, it will be created. The default is `pgmigrations`.

#### historyTableName

Name of the history table. If this table doesn't exist, it will be created. The default is `schema_history`.

#### skipPattern

Regex pattern to skip files.

#### useProceduralScript

Set to true to build a migration script with procedural extensions (PL/pgSQL script). Set to false to build a normal SQL transactional script. Default is false.

#### hashFunction

Default hash function used for hashing the content. The default value is the `SHA1` function:

```javascript
function(data) {
    const hash = crypto.createHash('sha1');
    hash.update(data);
    return hash.digest('hex');
}
```

#### sortByPath

Default: `true`.

Sorts non-versioned migrations by path and then by name for migrations in multiple directories.

#### sortFunction

Default sort function used for sorting migration names. The default value is `sortFunction: (a, b, config) => config.sortByPath ? a.script.localeCompare(b.script, "en") : a.name.localeCompare(b.name, "en")`.

#### versionSortFunction

Default sort function used for sorting migration versions. The default value is `versionSortFunction: (a, b, config) => a.version.localeCompare(b.version, "en", {numeric: true})`.


#### warnOnInvalidPrefix: true

Display warning if some migration file with the migration extension (`.sql`) doesn't have a valid prefix. This may be just some script file that can be referenced with `# script` tag. The default is false.

#### parseScriptTags

Parses migration scripts for special tags to be executed in the build time.

For now, the only tag that is implemented is `# import <file>`.

When parses finds `# import <file>` tag, it will insert the content of that file in the next lines. This can be anywhere in the migration script. For example, you would normally put this in a comment like this:

```sql
-- # import ./test.sql
```

Build will produce:

```sql
-- # import ./test.sql
test.sql content
```

But if you do this:

```sql
/*
# import ./test.sql
*/
```


Build will produce:

```sql
/*
# import ./test.sql
test.sql content
*/
```

The default is true.

#### parseEnvVars

Parses the enviroment variables in migration file content by replacing ${ENVVAR} placeholders.

For example: Enviroment variable called USERNAME will have this placeholder ${USERNAME} is replaced with the actual username.

Note: if you have a .env file in a root, it will be automatically loaded.

The default is true.

#### runOlderVersions

Set to true to run versioned migration even when higher version was applied. Default is false.

### Testing

Testing will execute script in migrations direcory in parallel mode.

#### failureExitCode

Return this error code on failure. Default is -1.

#### migrationAdditionalArgs

Additional psql arguments for migration and finalization. Deafault is nothing.

## Contributing

Contributions from the community are welcomed.
Please make a pull request with a description if you wish to contribute.

## License

This project is licensed under the terms of the MIT license.


