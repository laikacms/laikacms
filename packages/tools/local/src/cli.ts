#!/usr/bin/env node
import path from 'node:path';

import { NodeRuntime, NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Command, Flag } from 'effect/unstable/cli';

import { discoverConfig, generateConfig } from './config-codegen.js';
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
// Parent dispatcher.
// ---------------------------------------------------------------------------

const command = Command.make('laika-local').pipe(
  Command.withDescription(
    'Laika CMS dev tooling: local storage server (`serve`) and config codegen (`generate`).',
  ),
  Command.withSubcommands([serveCommand, generateCommand]),
);

const program = Command.run(command, { version: '0.2.0' }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
