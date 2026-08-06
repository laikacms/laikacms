import path from 'node:path';

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Command, Flag, Prompt } from 'effect/unstable/cli';

import { bootstrapApplication, type PackageManager, STARTERS } from './bootstrap.js';
import { CMS_BACKENDS, CMS_LOCALES, CMS_WIDGETS, type CmsSelection, DEFAULT_CMS_SELECTION } from './cms-codegen.js';
import { discoverConfig, generateConfig } from './config-codegen.js';
import { storageDrivers } from './drivers/registry.js';
import type { MigrateConfig } from './drivers/types.js';
import { loadMigrateConfig, runMigrate } from './migrate-runner.js';
import type { MigrateEvent } from './migrate.js';
import { layerStorageServer } from './server.js';
import { watchFile } from './watch.js';

const createDirectory = Flag.directory('directory').pipe(
  Flag.withAlias('d'),
  Flag.withDescription('Directory to create (default: ./my-laika-app, wizard asks)'),
  Flag.optional,
);
const createStarter = Flag.string('starter').pipe(
  Flag.withDescription(`Starter template (default: ${STARTERS[0]})`),
  Flag.optional,
);
const createName = Flag.string('name').pipe(
  Flag.withDescription('package.json name (default: directory name)'),
  Flag.optional,
);
const createTitle = Flag.string('title').pipe(
  Flag.withDescription('Starter site title (default: My Blog, wizard asks)'),
  Flag.optional,
);
const createPackageManager = Flag.string('package-manager').pipe(
  Flag.withDescription(
    'Package manager used to install dependencies: pnpm, npm, yarn, or bun (default: pnpm, wizard asks)',
  ),
  Flag.optional,
);
const createSkipInstall = Flag.boolean('skip-install').pipe(
  Flag.withDescription('Create the application without installing dependencies'),
  Flag.withDefault(false),
);
const listFlag = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.withDescription(description), Flag.optional);
const createBackends = listFlag(
  'backends',
  `Comma-separated CMS backends to register (default: ${
    DEFAULT_CMS_SELECTION.backends.join(',')
  }; wizard asks). One of: ${CMS_BACKENDS.map(b => b.name).join(', ')}`,
);
const createWidgets = listFlag(
  'widgets',
  `Comma-separated widgets to register (default: ${DEFAULT_CMS_SELECTION.widgets.join(',')}; wizard asks)`,
);
const createLocales = listFlag(
  'locales',
  'Comma-separated extra admin UI locales to register (default: none — `en` is built in; wizard asks)',
);
const createYes = Flag.boolean('yes').pipe(
  Flag.withAlias('y'),
  Flag.withDescription('Accept all defaults and skip the wizard prompts'),
  Flag.withDefault(false),
);

type Optional<A> = { _tag: 'Some', value: A } | { _tag: 'None' };

const parseList = (raw: string): string[] => raw.split(',').map(s => s.trim()).filter(s => s.length > 0);

/**
 * Resolve one wizard answer: an explicit flag always wins; otherwise prompt
 * when interactive, or fall back to the default.
 */
const resolve = <A>(
  flag: Optional<A>,
  interactive: boolean,
  prompt: Prompt.Prompt<A>,
  fallback: A,
) => flag._tag === 'Some' ? Effect.succeed(flag.value) : interactive ? prompt : Effect.succeed(fallback);

export const makeCreateCommand = (name = 'create', binName = 'laika') =>
  Command.make(
    name,
    {
      directory: createDirectory,
      starter: createStarter,
      packageName: createName,
      title: createTitle,
      packageManager: createPackageManager,
      skipInstall: createSkipInstall,
      backends: createBackends,
      widgets: createWidgets,
      locales: createLocales,
      yes: createYes,
    },
    flags =>
      Effect.gen(function*() {
        // The wizard is the default path: prompts fill in whatever flags left
        // out, so `laika create` alone walks through every choice. `--yes` (or
        // no TTY) keeps it scriptable.
        const interactive = !flags.yes && process.stdin.isTTY === true && process.stdout.isTTY === true;

        const starter = yield* resolve(
          flags.starter,
          interactive && STARTERS.length > 1,
          Prompt.select<string>({
            message: 'Which starter?',
            choices: STARTERS.map(s => ({ title: s, value: s })),
          }),
          STARTERS[0],
        );
        const directory = yield* resolve(
          flags.directory,
          interactive,
          Prompt.text({ message: 'Where should the app be created?', default: './my-laika-app' }),
          './my-laika-app',
        );
        const title = yield* resolve(
          flags.title,
          interactive,
          Prompt.text({ message: 'Site title?', default: 'My Blog' }),
          'My Blog',
        );
        const packageManager = yield* resolve(
          flags.packageManager,
          interactive,
          Prompt.select<string>({
            message: 'Package manager?',
            choices: (['pnpm', 'npm', 'yarn', 'bun'] as const).map(pm => ({ title: pm, value: pm })),
          }),
          'pnpm',
        );
        if (!['pnpm', 'npm', 'yarn', 'bun'].includes(packageManager)) {
          return yield* Effect.fail(new Error(`${binName} create: unsupported package manager "${packageManager}"`));
        }

        const resolveList = (
          flag: Optional<string>,
          prompt: Prompt.Prompt<Array<string>>,
          fallback: readonly string[],
        ) =>
          flag._tag === 'Some'
            ? Effect.succeed(parseList(flag.value))
            : interactive
            ? prompt
            : Effect.succeed([...fallback]);

        const backends = yield* resolveList(
          flags.backends,
          Prompt.multiSelect<string>({
            message: 'CMS backends to register (space toggles, enter confirms)',
            choices: CMS_BACKENDS.map(b => ({
              title: b.name,
              value: b.name,
              description: b.description,
              selected: DEFAULT_CMS_SELECTION.backends.includes(b.name),
            })),
            min: 1,
          }),
          DEFAULT_CMS_SELECTION.backends,
        );
        const widgets = yield* resolveList(
          flags.widgets,
          Prompt.multiSelect<string>({
            message: 'Widgets to register',
            choices: CMS_WIDGETS.map(w => ({
              title: w.name,
              value: w.name,
              description: w.description,
              selected: DEFAULT_CMS_SELECTION.widgets.includes(w.name),
            })),
          }),
          DEFAULT_CMS_SELECTION.widgets,
        );
        const locales = yield* resolveList(
          flags.locales,
          Prompt.multiSelect<string>({
            message: 'Extra admin UI locales (`en` is built in)',
            choices: CMS_LOCALES.map(l => ({ title: l, value: l })),
          }),
          [],
        );
        const cms: CmsSelection = { backends, widgets, codecs: [], locales };

        const result = yield* Effect.tryPromise({
          try: () =>
            bootstrapApplication({
              directory,
              starter,
              ...(flags.packageName._tag === 'Some' ? { name: flags.packageName.value } : {}),
              title,
              packageManager: packageManager as PackageManager,
              install: !flags.skipInstall,
              cms,
            }),
          catch: error => error instanceof Error ? error : new Error(String(error)),
        });
        yield* Effect.logInfo(`${binName} create: created ${result.name} in ${result.directory}`);
        yield* Effect.logInfo(
          `${binName} create: src/cms.ts registers backends [${result.cms.backends.join(', ')}], widgets [${
            result.cms.widgets.join(', ')
          }]`
            + (result.cms.locales.length > 0 ? `, locales [${result.cms.locales.join(', ')}]` : ''),
        );
        if (result.ignoredBuilds.length > 0) {
          yield* Effect.logWarning(
            `${binName} create: pnpm skipped the build scripts of ${
              result.ignoredBuilds.join(', ')
            } — run "pnpm approve-builds" in ${result.directory} to review and run them`,
          );
        }
      }),
  ).pipe(
    Command.withDescription(
      'Bootstrap a LaikaCMS application from a starter — an interactive wizard that also picks the CMS backends, widgets, and locales (use flags or --yes to skip prompts).',
    ),
  );

export const createCommand = makeCreateCommand();

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
 * The local-file JSON:API storage server command. The name and the bin label
 * used in log/error messages are parameterised so embedders can mount the
 * command under their own spelling (the `laika` CLI uses `laika local serve`).
 */
export const makeServeCommand = (name = 'serve', binName = 'laika local') =>
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

export const makeGenerateCommand = (name = 'generate', binName = 'laika local') =>
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

export const makeMigrateCommand = (name = 'migrate', binName = 'laika local') =>
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
