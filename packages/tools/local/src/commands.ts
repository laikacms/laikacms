import path from 'node:path';

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Command, Flag } from 'effect/unstable/cli';

import { discoverConfig, generateConfig } from './config-codegen.js';
import { storageDrivers } from './drivers/registry.js';
import type { MigrateConfig } from './drivers/types.js';
import { loadMigrateConfig, runMigrate } from './migrate-runner.js';
import type { MigrateEvent } from './migrate.js';
import { layerStorageServer } from './server.js';
import { watchFile } from './watch.js';

// ---------------------------------------------------------------------------
// `serve` subcommand — the existing storage-api HTTP server.
// ---------------------------------------------------------------------------

const root = Flag.directory('root').pipe(
  Flag.withAlias('r'),
  Flag.withDescription('Root directory served by the storage repo (default: cwd)'),
  Flag.withDefault(process.cwd()),
);

const port = Flag.integer('port').pipe(
  Flag.withAlias('p'),
  Flag.withDescription('Listen port (default: 3030)'),
  Flag.withDefault(3030),
);

const host = Flag.string('host').pipe(
  Flag.withAlias('H'),
  Flag.withDescription('Listen host (default: 127.0.0.1)'),
  Flag.withDefault('127.0.0.1'),
);

const defaultExtension = Flag.string('default-extension').pipe(
  Flag.withDescription('Default file extension for new objects (default: md)'),
  Flag.withDefault('md'),
);

const authToken = Flag.string('auth-token').pipe(
  Flag.withDescription(`Require 'Authorization: Bearer <token>' on every request`),
  Flag.optional,
);

/**
 * The local-file JSON:API storage server command. The name is parameterised so
 * downstream CLIs can mount it under a different spelling (`@laikacms/cli`
 * exposes it as `laika dev` in addition to `laika serve`).
 */
export const makeServeCommand = (name = 'serve', binName = 'laika-local') =>
  Command.make(
    name,
    { root, port, host, defaultExtension, authToken },
    ({ root, port, host, defaultExtension, authToken }) =>
      Effect.gen(function*() {
        const abs = path.resolve(root);
        yield* Effect.logInfo(`${binName}: serving ${abs} on http://${host}:${port}`);
        if (authToken._tag === 'Some') {
          yield* Effect.logInfo(`${binName}: auth bearer token required`);
        }
        yield* Layer.launch(
          layerStorageServer({
            root: abs,
            port,
            host,
            defaultExtension,
            authToken: authToken._tag === 'Some' ? authToken.value : undefined,
          }),
        );
      }),
  ).pipe(
    Command.withDescription(
      'Start the local-file JSON:API storage server for Laika CMS dev workflows.',
    ),
  );

export const serveCommand = makeServeCommand();

// ---------------------------------------------------------------------------
// `generate` subcommand — codegen typed TS from Decap `config.yaml`.
// The output is both a runtime value (the parsed YAML, frozen via `as const`)
// and the literal types TS infers from it — that's why this is `generate`
// rather than `types` (which would imply a types-only `.d.ts`).
// ---------------------------------------------------------------------------

const generateInput = Flag.string('input').pipe(
  Flag.withAlias('i'),
  Flag.withDescription(
    'Path to config.yaml (default: auto-discover ./config.{yml,yaml} or ./src/config.{yml,yaml})',
  ),
  Flag.optional,
);

const generateOutput = Flag.string('output').pipe(
  Flag.withAlias('o'),
  Flag.withDescription(
    'Path to generated .ts (default: config.gen.ts next to the input)',
  ),
  Flag.optional,
);

const generateWatch = Flag.boolean('watch').pipe(
  Flag.withAlias('w'),
  Flag.withDescription('Regenerate whenever the input file changes'),
  Flag.withDefault(false),
);

const resolvePaths = (
  binName: string,
  inputFlag: { _tag: 'Some', value: string } | { _tag: 'None' },
  outputFlag: { _tag: 'Some', value: string } | { _tag: 'None' },
): Effect.Effect<{ input: string, output: string }, Error> =>
  Effect.gen(function*() {
    let input: string;
    if (inputFlag._tag === 'Some') {
      input = path.resolve(inputFlag.value);
    } else {
      const found = yield* Effect.promise(() => discoverConfig(process.cwd()));
      if (!found.resolved) {
        yield* Effect.fail(
          new Error(
            `${binName} generate: no config file found. Searched:\n  ${
              found.searched.join('\n  ')
            }\nUse --input to point at one explicitly.`,
          ),
        );
        // unreachable, satisfy TS
        input = '';
      } else {
        input = found.resolved;
      }
    }
    const output = outputFlag._tag === 'Some'
      ? path.resolve(outputFlag.value)
      : path.join(path.dirname(input), 'config.gen.ts');
    return { input, output };
  });

export const makeGenerateCommand = (name = 'generate', binName = 'laika-local') =>
  Command.make(
    name,
    { input: generateInput, output: generateOutput, watch: generateWatch },
    ({ input, output, watch }) =>
      Effect.gen(function*() {
        const paths = yield* resolvePaths(binName, input, output);
        const result = yield* Effect.tryPromise({
          try: () => generateConfig({ input: paths.input, output: paths.output }),
          catch: e => e instanceof Error ? e : new Error(String(e)),
        });
        yield* Effect.logInfo(
          `${binName} generate: wrote ${result.output} from ${result.input}`,
        );

        if (!watch) return;

        yield* Effect.logInfo(`${binName} generate: watching ${paths.input}`);
        // Block the command on a never-resolving callback; the watcher runs
        // regeneration on each file change as a side effect. Interruption (SIGINT)
        // fires the AbortSignal which we use to dispose the fs watcher cleanly.
        yield* Effect.callback<never, never>((_resume, signal) => {
          let busy = false;
          const dispose = watchFile(paths.input, () => {
            if (busy) return;
            busy = true;
            generateConfig({ input: paths.input, output: paths.output })
              .then(({ output }) => console.log(`${binName} generate: wrote ${output}`))
              .catch((e: unknown) =>
                console.error(
                  `${binName} generate: ${e instanceof Error ? e.message : String(e)}`,
                )
              )
              .finally(() => {
                busy = false;
              });
          });
          signal.addEventListener('abort', () => dispose());
        });
      }),
  ).pipe(
    Command.withDescription(
      'Generate a typed TypeScript module from a Decap CMS config.yaml.',
    ),
  );

export const generateCommand = makeGenerateCommand();

// ---------------------------------------------------------------------------
// `migrate` subcommand — copy every atom from one storage repository to another
// of the same type. Backends are pluggable: see `drivers/registry.ts`. Each
// backend driver supplies the option→constructor mapping and (when needed)
// auto-installs its npm package on first use after a y/N prompt.
//
// Three input modes are accepted:
//   1. `--config <file>` — a JSON/YAML `{source, destination, migrate?}`
//   2. inline `--source-backend <name> --source-options <json>` (and
//      `--destination-*`)
//   3. the legacy FS shortcut `-s <dir> -d <dir>` (which lowers to
//      `--source-backend fs --source-options '{"root":...}'`)
// ---------------------------------------------------------------------------

const migrateConfigFile = Flag.string('config').pipe(
  Flag.withAlias('c'),
  Flag.withDescription('Path to a JSON/YAML migration config file'),
  Flag.optional,
);

const migrateSourceBackend = Flag.string('source-backend').pipe(
  Flag.withDescription('Source backend name (e.g. fs, vercel, surrealdb). See list-backends.'),
  Flag.optional,
);

const migrateSourceOptions = Flag.string('source-options').pipe(
  Flag.withDescription('JSON-encoded options for the source backend'),
  Flag.optional,
);

const migrateDestinationBackend = Flag.string('destination-backend').pipe(
  Flag.withDescription('Destination backend name'),
  Flag.optional,
);

const migrateDestinationOptions = Flag.string('destination-options').pipe(
  Flag.withDescription('JSON-encoded options for the destination backend'),
  Flag.optional,
);

const migrateSource = Flag.directory('source').pipe(
  Flag.withAlias('s'),
  Flag.withDescription('FS shortcut: source repository root directory'),
  Flag.optional,
);

const migrateDestination = Flag.directory('destination').pipe(
  Flag.withAlias('d'),
  Flag.withDescription('FS shortcut: destination repository root directory'),
  Flag.optional,
);

const migrateDefaultExtension = Flag.string('default-extension').pipe(
  Flag.withDescription(
    'FS shortcut: default file extension on the destination (default: md)',
  ),
  Flag.withDefault('md'),
);

const migrateFrom = Flag.string('from').pipe(
  Flag.withDescription(`Folder key to start the migration from (default: '', the root)`),
  Flag.withDefault(''),
);

const migrateOverwrite = Flag.boolean('overwrite').pipe(
  Flag.withDescription('Overwrite objects that already exist on the destination'),
  Flag.withDefault(false),
);

const migrateDryRun = Flag.boolean('dry-run').pipe(
  Flag.withDescription('Walk the source and log what would happen without writing anything'),
  Flag.withDefault(false),
);

const migrateConcurrency = Flag.integer('concurrency').pipe(
  Flag.withDescription('Number of object copies to run in parallel per folder (default: 4)'),
  Flag.withDefault(4),
);

const migratePageSize = Flag.integer('page-size').pipe(
  Flag.withDescription('Page size used when listing folders on the source (default: 1000)'),
  Flag.withDefault(1000),
);

const migrateNoInstall = Flag.boolean('no-install').pipe(
  Flag.withDescription('Refuse to auto-install missing backend packages (fail instead)'),
  Flag.withDefault(false),
);

type OptionalString = { _tag: 'Some', value: string } | { _tag: 'None' };

const parseJsonOptions = (
  binName: string,
  label: string,
  raw: string,
): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${binName} migrate: --${label}-options is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${binName} migrate: --${label}-options must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const buildConfigFromFlags = (binName: string, flags: {
  configFile: OptionalString,
  sourceBackend: OptionalString,
  sourceOptions: OptionalString,
  destinationBackend: OptionalString,
  destinationOptions: OptionalString,
  sourceDir: OptionalString,
  destinationDir: OptionalString,
  defaultExtension: string,
  from: string,
  overwrite: boolean,
  dryRun: boolean,
  concurrency: number,
  pageSize: number,
}): Effect.Effect<MigrateConfig, Error> =>
  Effect.gen(function*() {
    if (flags.configFile._tag === 'Some') {
      const cfg = yield* Effect.tryPromise({
        try: () => loadMigrateConfig(flags.configFile._tag === 'Some' ? flags.configFile.value : ''),
        catch: e => e instanceof Error ? e : new Error(String(e)),
      });
      return {
        ...cfg,
        migrate: {
          ...cfg.migrate,
          from: cfg.migrate?.from ?? flags.from,
          overwrite: cfg.migrate?.overwrite ?? flags.overwrite,
          dryRun: cfg.migrate?.dryRun ?? flags.dryRun,
          concurrency: cfg.migrate?.concurrency ?? flags.concurrency,
          pageSize: cfg.migrate?.pageSize ?? flags.pageSize,
        },
      } satisfies MigrateConfig;
    }

    const resolveSpec = (
      label: 'source' | 'destination',
      backendFlag: OptionalString,
      optionsFlag: OptionalString,
      dirFlag: OptionalString,
    ) => {
      if (backendFlag._tag === 'Some') {
        const opts = optionsFlag._tag === 'Some'
          ? parseJsonOptions(binName, label, optionsFlag.value)
          : {};
        return { backend: backendFlag.value, options: opts };
      }
      if (dirFlag._tag === 'Some') {
        return {
          backend: 'fs',
          options: { root: path.resolve(dirFlag.value), defaultExtension: flags.defaultExtension },
        };
      }
      throw new Error(
        `${binName} migrate: provide --${label}-backend (and optionally --${label}-options), `
          + `-${label === 'source' ? 's' : 'd'} <dir> for FS, or use --config.`,
      );
    };

    const source = yield* Effect.try({
      try: () => resolveSpec('source', flags.sourceBackend, flags.sourceOptions, flags.sourceDir),
      catch: e => e instanceof Error ? e : new Error(String(e)),
    });
    const destination = yield* Effect.try({
      try: () =>
        resolveSpec(
          'destination',
          flags.destinationBackend,
          flags.destinationOptions,
          flags.destinationDir,
        ),
      catch: e => e instanceof Error ? e : new Error(String(e)),
    });

    return {
      source,
      destination,
      migrate: {
        from: flags.from,
        overwrite: flags.overwrite,
        dryRun: flags.dryRun,
        concurrency: flags.concurrency,
        pageSize: flags.pageSize,
      },
    } satisfies MigrateConfig;
  });

const logEvent = (event: MigrateEvent): void => {
  switch (event.type) {
    case 'folder-discovered':
      return;
    case 'folder-created':
      console.log(`  + folder ${event.key || '/'}`);
      return;
    case 'folder-skipped':
      console.log(`  = folder ${event.key || '/'} (${event.reason})`);
      return;
    case 'object-copied':
      console.log(`  + object ${event.key}`);
      return;
    case 'object-skipped':
      console.log(`  = object ${event.key} (${event.reason})`);
      return;
    case 'error':
      console.error(`  ! ${event.key}: ${event.error.message}`);
      return;
  }
};

export const makeMigrateCommand = (name = 'migrate', binName = 'laika-local') =>
  Command.make(
    name,
    {
      configFile: migrateConfigFile,
      sourceBackend: migrateSourceBackend,
      sourceOptions: migrateSourceOptions,
      destinationBackend: migrateDestinationBackend,
      destinationOptions: migrateDestinationOptions,
      sourceDir: migrateSource,
      destinationDir: migrateDestination,
      defaultExtension: migrateDefaultExtension,
      from: migrateFrom,
      overwrite: migrateOverwrite,
      dryRun: migrateDryRun,
      concurrency: migrateConcurrency,
      pageSize: migratePageSize,
      noInstall: migrateNoInstall,
    },
    flags =>
      Effect.gen(function*() {
        const config = yield* buildConfigFromFlags(binName, flags);

        yield* Effect.logInfo(
          `${binName} migrate: ${config.source.backend} -> ${config.destination.backend}`
            + (config.migrate?.from ? ` (from='${config.migrate.from}')` : '')
            + (config.migrate?.dryRun ? ' [dry-run]' : '')
            + (config.migrate?.overwrite ? ' [overwrite]' : ''),
        );

        const result = yield* Effect.tryPromise({
          try: () =>
            runMigrate({
              config,
              resolve: { noInstall: flags.noInstall },
              onEvent: logEvent,
            }),
          catch: e => e instanceof Error ? e : new Error(String(e)),
        });

        yield* Effect.logInfo(
          `${binName} migrate: done. `
            + `folders: ${result.foldersCreated} created, ${result.foldersSkipped} skipped. `
            + `objects: ${result.objectsCopied} copied, ${result.objectsSkipped} skipped. `
            + `errors: ${result.errors.length}.`,
        );
        if (result.errors.length > 0) {
          return yield* Effect.fail(
            new Error(`${binName} migrate: completed with ${result.errors.length} error(s)`),
          );
        }
      }),
  ).pipe(
    Command.withDescription(
      'Copy every atom from one storage repository to another of the same type, '
        + 'across any registered backend (fs, vercel, surrealdb, …).',
    ),
  );

export const migrateCommand = makeMigrateCommand();

export const makeListBackendsCommand = (name = 'list-backends') =>
  Command.make(name, {}, () =>
    Effect.gen(function*() {
      for (const driver of storageDrivers) {
        const pkg = driver.packageName === 'laikacms'
          ? '(built-in)'
          : `${driver.packageName}@${driver.version} (subpath ${driver.subpath})`;
        yield* Effect.sync(() =>
          console.log(`  ${driver.name.padEnd(16)} ${driver.description}\n${' '.repeat(20)}${pkg}`)
        );
      }
    })).pipe(
      Command.withDescription(
        'List every registered storage backend and its pinned package version.',
      ),
    );

export const listBackendsCommand = makeListBackendsCommand();
