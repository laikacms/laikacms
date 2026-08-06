import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverOptionalPeerDependencies, synchronizeOptionalPeerDependencies } from './cms-extension-dependencies.js';

describe('discoverOptionalPeerDependencies', () => {
  it('discovers optional peers imported by a selected extension', async () => {
    const projectDirectory = await createProjectFixture();

    await expect(discoverOptionalPeerDependencies({
      projectDirectory,
      packageName: '@example/cms',
      extensionSubpaths: ['widgets/map'],
    })).resolves.toEqual({ ol: '^10.0.0' });
  });

  it('does not return an optional peer already installed by the application', async () => {
    const projectDirectory = await createProjectFixture({ installOl: true });

    await expect(discoverOptionalPeerDependencies({
      projectDirectory,
      packageName: '@example/cms',
      extensionSubpaths: ['widgets/map'],
    })).resolves.toEqual({});
  });

  it('adds discovered peers to the application dependencies', async () => {
    const projectDirectory = await createProjectFixture();

    await expect(synchronizeOptionalPeerDependencies({
      projectDirectory,
      packageName: '@example/cms',
      extensionSubpaths: ['widgets/map'],
    })).resolves.toEqual(['ol']);

    const packageJson = JSON.parse(await readFile(path.join(projectDirectory, 'package.json'), 'utf8'));
    expect(packageJson.dependencies).toEqual({ ol: '^10.0.0' });
  });

  it('preserves an application dependency even when it is not installed yet', async () => {
    const projectDirectory = await createProjectFixture({ declaredOl: 'workspace:*' });

    await expect(synchronizeOptionalPeerDependencies({
      projectDirectory,
      packageName: '@example/cms',
      extensionSubpaths: ['widgets/map'],
    })).resolves.toEqual([]);

    const packageJson = JSON.parse(await readFile(path.join(projectDirectory, 'package.json'), 'utf8'));
    expect(packageJson.dependencies.ol).toBe('workspace:*');
  });

  it('normalizes scoped external subpaths to their package name', async () => {
    const projectDirectory = await createProjectFixture();

    await expect(discoverOptionalPeerDependencies({
      projectDirectory,
      packageName: '@example/cms',
      extensionSubpaths: ['widgets/icons'],
    })).resolves.toEqual({ '@example/icons': '^2.0.0' });
  });
});

async function createProjectFixture(
  options: { declaredOl?: string, installOl?: boolean } = {},
): Promise<string> {
  const projectDirectory = await mkdtemp(path.join(tmpdir(), 'laikacli-extension-peers-'));
  const packageDirectory = path.join(projectDirectory, 'node_modules', '@example', 'cms');
  await mkdir(path.join(packageDirectory, 'dist', 'widgets', 'map'), { recursive: true });
  await mkdir(path.join(packageDirectory, 'dist', 'widgets', 'icons'), { recursive: true });
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    `${
      JSON.stringify({
        private: true,
        ...(options.declaredOl ? { dependencies: { ol: options.declaredOl } } : {}),
      })
    }\n`,
  );
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify(
      {
        name: '@example/cms',
        type: 'module',
        exports: {
          './package.json': './package.json',
          './widgets/*': './dist/widgets/*/index.js',
        },
        dependencies: { react: '^19.0.0' },
        peerDependencies: { ol: '^10.0.0', '@example/icons': '^2.0.0' },
        peerDependenciesMeta: {
          ol: { optional: true },
          '@example/icons': { optional: true },
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(packageDirectory, 'dist', 'widgets', 'map', 'index.js'),
    `import './map-control.js';\nexport const Widget = () => ({});\n`,
  );
  await writeFile(
    path.join(packageDirectory, 'dist', 'widgets', 'map', 'map-control.js'),
    `import Map from 'ol/Map.js';\nimport styles from 'ol/ol.css?inline';\nimport React from 'react';\nexport { Map, React, styles };\n`,
  );
  await writeFile(
    path.join(packageDirectory, 'dist', 'widgets', 'icons', 'index.js'),
    `import { icons } from '@example/icons/all.js';\nexport { icons };\n`,
  );
  if (options.installOl) {
    const olDirectory = path.join(projectDirectory, 'node_modules', 'ol');
    await mkdir(olDirectory, { recursive: true });
    await writeFile(
      path.join(olDirectory, 'package.json'),
      '{"name":"ol","version":"10.0.0","exports":"./index.js"}\n',
    );
    await writeFile(path.join(olDirectory, 'index.js'), 'export {};\n');
  }
  return projectDirectory;
}
