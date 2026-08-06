#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import { Command } from 'effect/unstable/cli';

import packageJson from '../package.json' with { type: 'json' };
import {
  makeCreateCommand,
  makeGenerateCommand,
  makeListBackendsCommand,
  makeMigrateCommand,
  makeServeCommand,
} from './commands.js';

// Everything local-dev lives under the `local` namespace: `laika local serve`,
// `laika local generate`, … — leaving the top level free for future
// non-local commands (deploy, login, …). The package ships two bins for the
// same entry: `laikacli` (canonical, matches the npm name so `npx laikacli`
// resolves) and `laika` (short alias for installed use).
const localCommand = Command.make('local').pipe(
  Command.withDescription(
    'Local-file dev tooling: storage server (`serve`), config codegen (`generate`), and repository migrations (`migrate`).',
  ),
  Command.withSubcommands([
    makeServeCommand('serve', 'laika local'),
    makeGenerateCommand('generate', 'laika local'),
    makeMigrateCommand('migrate', 'laika local'),
    makeListBackendsCommand(),
  ]),
);

const command = Command.make('laikacli').pipe(
  Command.withDescription('The Laika CMS CLI.'),
  Command.withSubcommands([makeCreateCommand(), localCommand]),
);

const program = Command.run(command, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
