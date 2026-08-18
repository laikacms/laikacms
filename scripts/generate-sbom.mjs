#!/usr/bin/env node
// LCMS-886: generate CycloneDX SBOMs for the published packages (laikacms,
// @laikacms/server) using pnpm's built-in `pnpm sbom` command (pnpm >=10.16,
// no extra dependency needed). Local/publish-time only — never wired into a
// GitHub Actions workflow (CI billing is org-wide blocked; see RELEASING.md
// and AGENTS.md).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(rootDir, 'sbom');

const packages = ['laikacms', '@laikacms/server'];

mkdirSync(outDir, { recursive: true });

for (const name of packages) {
  const fileName = name.replace('@laikacms/', 'laikacms-');
  const outFile = join(outDir, `${fileName}.cdx.json`);
  console.log(`[sbom] generating ${outFile}`);
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      name,
      'sbom',
      '--sbom-format',
      'cyclonedx',
      '--sbom-spec-version',
      '1.6',
      '--prod',
      '--out',
      outFile,
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error(`[sbom] failed generating SBOM for ${name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`[sbom] done — output in ${outDir}`);
