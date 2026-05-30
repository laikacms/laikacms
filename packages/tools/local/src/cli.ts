#!/usr/bin/env node
import path from 'node:path';

import { NodeRuntime, NodeServices } from '@effect/platform-node';
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

const serveCommand = Command.make(
  'serve',
  { root, port, host, defaultExtension, authToken },
  ({ root, port, host, defaultExtension, authToken }) =>
    Effect.gen(function*() {
      const abs = path.resolve(root);
      yield* Effect.logInfo(`laika-local: serving ${abs} on http://${host}:${port}`);
      if (authToken._tag === 'Some') {
        yield* Effect.logInfo(`laika-local: auth bearer token required`);
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
            `laika-local generate: no config file found. Searched:\n  ${
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

const generateCommand = Command.make(
  'generate',
  { input: generateInput, output: generateOutput, watch: generateWatch },
  ({ input, output, watch }) =>
    Effect.gen(function*() {
      const paths = yield* resolvePaths(input, output);
      const result = yield* Effect.tryPromise({
        try: () => generateConfig({ input: paths.input, output: paths.output }),
        catch: e => e instanceof Error ? e : new Error(String(e)),
      });
      yield* Effect.logInfo(
        `laika-local generate: wrote ${result.output} from ${result.input}`,
      );

      if (!watch) return;

      yield* Effect.logInfo(`laika-local generate: watching ${paths.input}`);
      // Block the command on a never-resolving callback; the watcher runs
      // regeneration on each file change as a side effect. Interruption (SIGINT)
      // fires the AbortSignal which we use to dispose the fs watcher cleanly.
      yield* Effect.callback<never, never>((_resume, signal) => {
        let busy = false;
        const dispose = watchFile(paths.input, () => {
          if (busy) return;
          busy = true;
          generateConfig({ input: paths.input, output: paths.output })
            .then(({ output }) => console.log(`laika-local generate: wrote ${output}`))
            .catch((e: unknown) =>
              console.error(
                `laika-local generate: ${e instanceof Error ? e.message : String(e)}`,
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

const parseJsonOptions = (label: string, raw: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `laika-local migrate: --${label}-options is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`laika-local migrate: --${label}-options must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const buildConfigFromFlags = (flags: {
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
          ? parseJsonOptions(label, optionsFlag.value)
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
        `laika-local migrate: provide --${label}-backend (and optionally --${label}-options), `
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

const migrateCommand = Command.make(
  'migrate',
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
      const config = yield* buildConfigFromFlags(flags);

      yield* Effect.logInfo(
        `laika-local migrate: ${config.source.backend} -> ${config.destination.backend}`
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
        `laika-local migrate: done. `
          + `folders: ${result.foldersCreated} created, ${result.foldersSkipped} skipped. `
          + `objects: ${result.objectsCopied} copied, ${result.objectsSkipped} skipped. `
          + `errors: ${result.errors.length}.`,
      );
      if (result.errors.length > 0) {
        return yield* Effect.fail(
          new Error(`laika-local migrate: completed with ${result.errors.length} error(s)`),
        );
      }
    }),
).pipe(
  Command.withDescription(
    'Copy every atom from one storage repository to another of the same type, '
      + 'across any registered backend (fs, vercel, surrealdb, …).',
  ),
);

const listBackendsCommand = Command.make('list-backends', {}, () =>
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
    Command.withDescription('List every registered storage backend and its pinned package version.'),
  );

// ---------------------------------------------------------------------------
// Parent dispatcher.
// ---------------------------------------------------------------------------

const command = Command.make('laika-local').pipe(
  Command.withDescription(
    'Laika CMS dev tooling: local storage server (`serve`), config codegen (`generate`), and repository migrations (`migrate`).',
  ),
  Command.withSubcommands([serveCommand, generateCommand, migrateCommand, listBackendsCommand]),
);

const program = Command.run(command, { version: '0.2.0' }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
