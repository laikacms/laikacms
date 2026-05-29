import fs from 'node:fs/promises';
import path from 'node:path';

import jsYaml from 'js-yaml';

import type { ResolveOptions } from './drivers/install.js';
import { buildStorageRepository } from './drivers/registry.js';
import type { BackendSpec, MigrateConfig } from './drivers/types.js';
import { type MigrateEvent, migrateStorage, type MigrateStorageResult } from './migrate.js';

/**
 * Validate the unknown shape from a JSON / YAML config file and assert it
 * looks like a {@link MigrateConfig}. Throws an `Error` with a path-prefixed
 * message on the first problem.
 */
const parseConfig = (raw: unknown, source: string): MigrateConfig => {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`laika-local: ${source}: top-level config must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const readSpec = (key: 'source' | 'destination'): BackendSpec => {
    const v = obj[key];
    if (!v || typeof v !== 'object') {
      throw new Error(`laika-local: ${source}: "${key}" must be an object`);
    }
    const spec = v as Record<string, unknown>;
    if (typeof spec.backend !== 'string' || spec.backend.length === 0) {
      throw new Error(`laika-local: ${source}: "${key}.backend" must be a string`);
    }
    const options = spec.options;
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      throw new Error(`laika-local: ${source}: "${key}.options" must be an object`);
    }
    return {
      backend: spec.backend,
      options: (options as Record<string, unknown>) ?? {},
    };
  };
  return {
    source: readSpec('source'),
    destination: readSpec('destination'),
    migrate: obj.migrate && typeof obj.migrate === 'object'
      ? (obj.migrate as MigrateConfig['migrate'])
      : undefined,
  };
};

/**
 * Read and parse a migrate config file. Supports `.json`, `.yaml`, and `.yml`
 * extensions; everything else is rejected.
 */
export const loadMigrateConfig = async (filePath: string): Promise<MigrateConfig> => {
  const abs = path.resolve(filePath);
  const text = await fs.readFile(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  let raw: unknown;
  if (ext === '.json') {
    raw = JSON.parse(text);
  } else if (ext === '.yaml' || ext === '.yml') {
    raw = jsYaml.load(text);
  } else {
    throw new Error(
      `laika-local: config file extension "${ext}" not supported. Use .json, .yaml, or .yml.`,
    );
  }
  return parseConfig(raw, abs);
};

export interface RunMigrateOptions {
  readonly config: MigrateConfig;
  readonly resolve?: ResolveOptions;
  readonly onEvent?: (event: MigrateEvent) => void;
}

/**
 * Top-level orchestrator: resolves both backends (auto-installing on demand),
 * constructs source + destination repositories, then runs {@link migrateStorage}.
 *
 * Per-backend `helpers` (the {@link StorageDriver}s in `drivers/storage/`)
 * supply the option→constructor mapping; this function just wires them up and
 * defers to the base helper.
 */
export const runMigrate = async (
  options: RunMigrateOptions,
): Promise<MigrateStorageResult> => {
  const { config, resolve, onEvent } = options;
  const source = await buildStorageRepository(
    config.source.backend,
    config.source.options,
    resolve,
  );
  const destination = await buildStorageRepository(
    config.destination.backend,
    config.destination.options,
    resolve,
  );
  return migrateStorage(source, destination, {
    from: config.migrate?.from,
    overwrite: config.migrate?.overwrite,
    dryRun: config.migrate?.dryRun,
    pageSize: config.migrate?.pageSize,
    concurrency: config.migrate?.concurrency,
    onEvent,
  });
};
