import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadMigrateConfig } from './migrate-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcms-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(filename: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// loadMigrateConfig — JSON
// ---------------------------------------------------------------------------

describe('loadMigrateConfig (JSON)', () => {
  it('parses a valid minimal config', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { backend: 'fs', options: { root: '/src' } },
        destination: { backend: 'fs', options: { root: '/dst' } },
      }),
    );

    const config = await loadMigrateConfig(p);

    expect(config.source.backend).toBe('fs');
    expect(config.destination.backend).toBe('fs');
    expect(config.migrate).toBeUndefined();
  });

  it('parses optional migrate options', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { backend: 'fs' },
        destination: { backend: 's3' },
        migrate: { dryRun: true, concurrency: 2 },
      }),
    );

    const config = await loadMigrateConfig(p);

    expect(config.migrate?.dryRun).toBe(true);
    expect(config.migrate?.concurrency).toBe(2);
  });

  it('throws when top-level value is not an object', async () => {
    const p = await writeConfig('migrate.json', JSON.stringify(42));

    await expect(loadMigrateConfig(p)).rejects.toThrow('top-level config must be an object');
  });

  it('throws when source is missing', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        destination: { backend: 'fs' },
      }),
    );

    await expect(loadMigrateConfig(p)).rejects.toThrow('"source" must be an object');
  });

  it('throws when destination is missing', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { backend: 'fs' },
      }),
    );

    await expect(loadMigrateConfig(p)).rejects.toThrow('"destination" must be an object');
  });

  it('throws when source.backend is missing', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { options: {} },
        destination: { backend: 'fs' },
      }),
    );

    await expect(loadMigrateConfig(p)).rejects.toThrow('"source.backend" must be a string');
  });

  it('throws when source.backend is an empty string', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { backend: '' },
        destination: { backend: 'fs' },
      }),
    );

    await expect(loadMigrateConfig(p)).rejects.toThrow('"source.backend" must be a string');
  });

  it('throws when source.options is not an object', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { backend: 'fs', options: 'bad' },
        destination: { backend: 'fs' },
      }),
    );

    await expect(loadMigrateConfig(p)).rejects.toThrow('"source.options" must be an object');
  });

  it('defaults options to empty object when absent', async () => {
    const p = await writeConfig(
      'migrate.json',
      JSON.stringify({
        source: { backend: 'fs' },
        destination: { backend: 'fs' },
      }),
    );

    const config = await loadMigrateConfig(p);

    expect(config.source.options).toEqual({});
    expect(config.destination.options).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// loadMigrateConfig — YAML
// ---------------------------------------------------------------------------

describe('loadMigrateConfig (YAML)', () => {
  it('parses a valid .yaml config', async () => {
    const yaml = `
source:
  backend: fs
  options:
    root: /src
destination:
  backend: fs
  options:
    root: /dst
`;
    const p = await writeConfig('migrate.yaml', yaml);

    const config = await loadMigrateConfig(p);

    expect(config.source.backend).toBe('fs');
    expect(config.destination.backend).toBe('fs');
  });

  it('parses a valid .yml config', async () => {
    const yaml = `
source:
  backend: s3
destination:
  backend: r2
`;
    const p = await writeConfig('migrate.yml', yaml);

    const config = await loadMigrateConfig(p);

    expect(config.source.backend).toBe('s3');
    expect(config.destination.backend).toBe('r2');
  });

  it('throws for unsupported file extension', async () => {
    const p = await writeConfig('migrate.toml', '[source]\nbackend = "fs"\n');

    await expect(loadMigrateConfig(p)).rejects.toThrow('extension ".toml" not supported');
  });
});
