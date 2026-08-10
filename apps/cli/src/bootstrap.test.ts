import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bootstrapApplication, parseIgnoredBuilds } from './bootstrap.js';

describe('bootstrapApplication', () => {
  it('copies and configures the Astro starter without installing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'laikacli-bootstrap-'));
    const destination = path.join(root, 'my-blog');

    const result = await bootstrapApplication({
      directory: destination,
      name: '@example/my-blog',
      title: 'Example Journal',
      install: false,
    });

    expect(result).toMatchObject({
      directory: destination,
      installed: false,
      name: '@example/my-blog',
      starter: 'starter-astro-blog',
      ignoredBuilds: [],
    });
    const packageJson = JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'));
    expect(packageJson.name).toBe('@example/my-blog');
    expect(packageJson.engines).toEqual({ node: '24.x' });
    expect(await readFile(path.join(destination, 'src/pages/index.astro'), 'utf8'))
      .toContain('Example Journal');
    const admin = await readFile(path.join(destination, 'src/pages/admin/index.astro'), 'utf8');
    expect(admin).toContain('load_config_file: false');
    expect(admin).toContain("import { init } from '../../cms.js'");
    expect(admin).not.toContain('unpkg.com/decap-cms');
    // The admin entry must route through ../../cms.js, never import a Decap app
    // bundle directly (bare or styled) — the wizard-generated cms.ts owns that.
    expect(admin).not.toContain("from '@laikacms/decap-cms/");
    // src/cms.ts is regenerated from the (default) selection: the bare,
    // non-laika app plus explicit registrations.
    const cms = await readFile(path.join(destination, 'src/cms.ts'), 'utf8');
    expect(cms).toContain("from '@laikacms/decap-cms/laika-app/bare'");
    expect(cms).toContain(`CMS.registerLocale('en', en);`);
    expect(cms).toContain(`CMS.registerBackend('laika', createLaikaBackend());`);
    // Without these approvals a pnpm install silently skips the build scripts.
    const workspace = await readFile(path.join(destination, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('esbuild: true');
    expect(workspace).toContain('msgpackr-extract: true');
  });

  it('writes src/cms.ts from a custom backend/widget/locale selection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'laikacli-bootstrap-'));
    const destination = path.join(root, 'my-blog');

    const result = await bootstrapApplication({
      directory: destination,
      install: false,
      cms: { backends: ['laika', 'github'], widgets: ['string', 'datetime'], locales: ['nl'] },
    });

    expect(result.cms).toEqual({ backends: ['laika', 'github'], widgets: ['string', 'datetime'], locales: ['nl'] });
    const cms = await readFile(path.join(destination, 'src/cms.ts'), 'utf8');
    expect(cms).toContain(`CMS.registerBackend('github', GitHubBackend);`);
    expect(cms).toContain(`CMS.registerLocale('nl', nl);`);
    expect(cms).not.toContain('richtext');
  });

  it('configures Yarn with a scannable node_modules install', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'laikacli-bootstrap-'));
    const destination = path.join(root, 'yarn-blog');

    await bootstrapApplication({
      directory: destination,
      packageManager: 'yarn',
      install: false,
    });

    expect(await readFile(path.join(destination, '.yarnrc.yml'), 'utf8'))
      .toBe('nodeLinker: node-modules\n');
  });

  it('installs optional peers imported by selected CMS extensions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'laikacli-bootstrap-'));
    const destination = path.join(root, 'map-blog');

    await bootstrapApplication({
      directory: destination,
      packageManager: 'pnpm',
      cms: { backends: ['laika'], widgets: ['map'], codecs: [], locales: [] },
    });

    const packageJson = JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'));
    expect(packageJson.dependencies.ol).toBe(
      '^6.9.0 || ^7.0.0 || ^8.0.0 || ^9.0.0 || ^10.0.0',
    );
  }, 120_000);

  it('rejects an invalid selection before touching the destination', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'laikacli-bootstrap-'));
    const destination = path.join(root, 'my-blog');

    await expect(bootstrapApplication({
      directory: destination,
      install: false,
      cms: { backends: ['laika'], widgets: ['nope'], locales: [] },
    })).rejects.toThrow(/Unknown widgets: nope/);
    await expect(readFile(path.join(destination, 'package.json'), 'utf8')).rejects.toThrow();
  });

  it('parses the ignored-builds report from pnpm', () => {
    expect(parseIgnoredBuilds([
      'Automatically ignored builds during installation:',
      '  esbuild',
      '  msgpackr-extract',
      'hint: To allow the execution of build scripts for a package, add its name to "allowBuilds" and set to "true", then run "pnpm rebuild".',
      'hint: For example:',
      'hint: allowBuilds:',
      'hint:   esbuild: true',
    ].join('\n'))).toEqual(['esbuild', 'msgpackr-extract']);
    expect(parseIgnoredBuilds('Automatically ignored builds during installation:\n  None\n')).toEqual([]);
    expect(
      parseIgnoredBuilds(
        'Automatically ignored builds during installation:\n  Cannot identify as no node_modules found\n',
      ),
    ).toEqual([]);
    expect(parseIgnoredBuilds('')).toEqual([]);
  });

  it('refuses to overwrite a non-empty destination', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'laikacli-bootstrap-'));
    const destination = path.join(root, 'existing');
    await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'keep');

    await expect(bootstrapApplication({ directory: destination, install: false }))
      .rejects.toThrow('Destination is not empty');
  });
});
