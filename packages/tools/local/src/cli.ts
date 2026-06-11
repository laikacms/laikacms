#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import { Command } from 'effect/unstable/cli';

import packageJson from '../package.json' with { type: 'json' };
import { generateCommand, listBackendsCommand, migrateCommand, serveCommand } from './commands.js';

const command = Command.make('laika-local').pipe(
  Command.withDescription(
    'Laika CMS dev tooling: local storage server (`serve`), config codegen (`generate`), and repository migrations (`migrate`).',
  ),
  Command.withSubcommands([serveCommand, generateCommand, migrateCommand, listBackendsCommand]),
);

const program = Command.run(command, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
