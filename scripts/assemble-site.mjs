#!/usr/bin/env node
// Assemble the deployable apex site (laikacms.com) for Cloudflare Pages:
//   site-dist/       <- apps/website/dist      (marketing SPA + _headers/_redirects)
//   site-dist/docs/  <- docs/.vitepress/dist   (VitePress, built with base '/docs/')
//
// No root 404.html is emitted on purpose: Pages then falls back to
// /index.html for unknown paths, which is what the SPA's deep links need.
// Invoked by `pnpm build:site` after both builds have run.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const websiteDist = path.join(root, 'apps/website/dist');
const docsDist = path.join(root, 'docs/.vitepress/dist');
const out = path.join(root, 'site-dist');

for (const dir of [websiteDist, docsDist]) {
  if (!existsSync(path.join(dir, 'index.html'))) {
    console.error(`missing ${path.relative(root, dir)}/index.html — run \`pnpm build:site\`, not this script directly`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
cpSync(websiteDist, out, { recursive: true });
cpSync(docsDist, path.join(out, 'docs'), { recursive: true });

for (const required of ['_headers', '_redirects', 'index.html', 'docs/index.html']) {
  if (!existsSync(path.join(out, required))) {
    console.error(`assembly produced no ${required} — refusing to continue`);
    process.exit(1);
  }
}
console.log(`assembled ${path.relative(root, out)}/ (website + docs)`);
