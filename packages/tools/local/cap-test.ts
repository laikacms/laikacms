// One-off verification harness for the JSON:API improvements:
//   1. /capabilities endpoint on every API
//   2. resource-level links.self
//   3. pagination via links (not meta)
//   4. meta.page.total from LaikaDone
//   5. capability sharing: FS storage caps bubble up through contentbase
//      repos and out via documents-api + assets-api /capabilities.
//
// Run: `node cap-test.mjs` from this dir. Spins up a Hono server on 4400,
// then runs assertions via fetch. Exits non-zero on any mismatch.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { buildAssetsApi } from 'laikacms/assets-api';
import { DefaultContentBaseSettingsProvider } from 'laikacms/contentbase-settings-default';
import { buildJsonApi as buildDocumentsApi } from 'laikacms/documents-api';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { buildJsonApi as buildStorageApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

const ROOT = '/tmp/cap-test-content';

// --- fixtures --------------------------------------------------------------
await rm(ROOT, { recursive: true, force: true });
await mkdir(`${ROOT}/posts`, { recursive: true });
await mkdir(`${ROOT}/uploads`, { recursive: true });
await mkdir(`${ROOT}/.contentbase`, { recursive: true });
// Pre-seed contentbase settings so the lazy bootstrap doesn't run during the test.
await writeFile(`${ROOT}/.contentbase/settings.json`, JSON.stringify({ collections: {} }));
const frontmatter = (n) => `---\ntitle: Post ${n}\nbody: hello ${n}\n---\n`;
for (const n of ['001', '002', '003']) {
  await writeFile(`${ROOT}/posts/${n}.md`, frontmatter(n));
}
await writeFile(`${ROOT}/uploads/pixel.png`, Buffer.from([137, 80, 78, 71]));

// --- repo stack ------------------------------------------------------------
const storage = new FileSystemStorageRepository(
  ROOT,
  { md: markdownSerializer, markdown: markdownSerializer, yaml: yamlSerializer, yml: yamlSerializer, json: jsonSerializer },
  'md',
);
const settings = new DefaultContentBaseSettingsProvider({ storage });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const storageApi = buildStorageApi({ repo: storage, basePath: '/storage' });
const documentsApi = buildDocumentsApi({ repo: documents, basePath: '/documents' });
const assetsApi = buildAssetsApi({ repository: assets, basePath: '/assets' });

const app = new Hono();
app.all('/storage/*', (c) => storageApi.fetch(c.req.raw));
app.all('/documents/*', (c) => documentsApi.fetch(c.req.raw));
app.all('/assets/*', (c) => assetsApi.fetch(c.req.raw));

const PORT = 4400;
const server = serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`cap-test: listening on http://127.0.0.1:${port}`);
});

// --- assertions ------------------------------------------------------------
const base = `http://127.0.0.1:${PORT}`;
const fails = [];
const ok = (name) => console.log(`  ok  ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name} — ${detail}`); fails.push(name); };

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
};

const assert = (name, cond, detail) => {
  if (cond) ok(name);
  else bad(name, detail);
};

console.log('\n[1] /capabilities exposed on every API');
const sCaps = await get('/storage/capabilities');
const dCaps = await get('/documents/capabilities');
const aCaps = await get('/assets/capabilities');
assert('storage  /capabilities returns 200', sCaps.status === 200, `got ${sCaps.status}`);
assert('docs     /capabilities returns 200', dCaps.status === 200, `got ${dCaps.status}`);
assert('assets   /capabilities returns 200', aCaps.status === 200, `got ${aCaps.status}`);

console.log('\n[2] capability sharing: storage caps bubble through contentbase repos');
const sPag = sCaps.body?.data?.attributes?.pagination;
const dPag = dCaps.body?.data?.attributes?.pagination;
const aPag = aCaps.body?.data?.attributes?.pagination;
assert(
  'storage pagination supported, cursor=false (FS in-mem)',
  sPag?.supported === true && sPag?.styles?.cursor === false,
  JSON.stringify(sPag),
);
assert(
  'documents pagination inherits storage shape',
  JSON.stringify(dPag?.styles) === JSON.stringify(sPag?.styles),
  `docs=${JSON.stringify(dPag?.styles)} vs storage=${JSON.stringify(sPag?.styles)}`,
);
assert(
  'assets pagination inherits storage shape',
  JSON.stringify(aPag?.styles) === JSON.stringify(sPag?.styles),
  `assets=${JSON.stringify(aPag?.styles)} vs storage=${JSON.stringify(sPag?.styles)}`,
);

console.log('\n[3] resource-level links.self');
const sObj = await get('/storage/objects/posts%2F001');
assert(
  'storage object has links.self',
  sObj.body?.data?.links?.self === '/storage/objects/posts%2F001',
  JSON.stringify(sObj.body?.data?.links),
);
const sCap = sCaps.body?.data;
assert(
  'storage-capabilities has links.self',
  sCap?.links?.self === '/storage/capabilities',
  JSON.stringify(sCap?.links),
);

console.log('\n[4] metadata on `meta` (not `attributes`)');
assert(
  'storage object: meta.extension present',
  sObj.body?.data?.meta?.extension === 'md',
  JSON.stringify(sObj.body?.data?.meta),
);
assert(
  'storage object: attributes.metadata absent',
  sObj.body?.data?.attributes?.metadata === undefined,
  `unexpected ${JSON.stringify(sObj.body?.data?.attributes?.metadata)}`,
);

console.log('\n[5] documents list: links.self per item + pagination via links');
// Diagnostic: probe storage layer (works) → docs layer (hangs?) to bisect.
console.log('  (probing storage.getObject for missing .contentbase/settings…)');
const sGet = await Promise.race([
  (async () => {
    const it = storage.getObject('.contentbase/settings')[Symbol.asyncIterator]();
    while (true) {
      const step = await it.next();
      if (step.done) return `value=${JSON.stringify(step.value)?.slice(0, 80)}`;
    }
  })(),
  new Promise((_, rej) => setTimeout(() => rej(new Error('getObject timed out')), 3000)),
]).catch(e => `ERR: ${(e as Error).message}`);
console.log(`  storage.getObject('.contentbase/settings') → ${sGet}`);

console.log('  (probing settings.getSettings…)');
const sSet = await Promise.race([
  settings.getSettings().then(r => `Result.${r._tag}`),
  new Promise((_, rej) => setTimeout(() => rej(new Error('getSettings timed out')), 5000)),
]).catch(e => `ERR: ${(e as Error).message}`);
console.log(`  settings.getSettings() → ${sSet}`);

console.log('  (probing storage repo directly…)');
const sProbe = await Promise.race([
  (async () => {
    let count = 0;
    for await (const chunk of storage.listAtomSummaries('posts', { depth: 1, pagination: { perPage: 10 } })) {
      for (const el of chunk) if (el._tag === 'Data') count++;
    }
    return `${count} items`;
  })(),
  new Promise((_, rej) => setTimeout(() => rej(new Error('storage timed out')), 5000)),
]).catch(e => `ERR: ${(e as Error).message}`);
console.log(`  storage.listAtomSummaries → ${sProbe}`);

console.log('  (probing docs repo directly…)');
const probe = await Promise.race([
  (async () => {
    const stream = documents.listRecordSummaries({ folder: 'posts', depth: 1, type: 'published', pagination: { perPage: 10 } });
    let count = 0;
    for await (const chunk of stream) {
      for (const el of chunk) if (el._tag === 'Data') count++;
    }
    return `${count} items`;
  })(),
  new Promise((_, rej) => setTimeout(() => rej(new Error('repo timed out after 5s')), 5000)),
]).catch(e => `ERR: ${(e as Error).message}`);
console.log(`  documents.listRecordSummaries → ${probe}`);
const dList = await get('/documents/record-summaries?filter%5Bfolder%5D=posts');
assert('documents record-summaries 200', dList.status === 200, `got ${dList.status}`);
const dItems = dList.body?.data ?? [];
assert('documents list has 3 items', dItems.length === 3, `got ${dItems.length}`);
const allHaveSelf = dItems.every((it) => typeof it.links?.self === 'string' && it.links.self.startsWith('/documents/'));
assert('every documents item has links.self', allHaveSelf, JSON.stringify(dItems.map(i => i.links)));
assert(
  'documents collection has links (top-level)',
  typeof dList.body?.links === 'object',
  JSON.stringify(dList.body?.links),
);

console.log('\n[6] meta carries only aggregate counts — never cursor/hasMore');
const dMeta = dList.body?.meta ?? {};
assert(
  'documents list: no meta.page.cursor',
  dMeta.page?.cursor === undefined,
  `unexpected ${dMeta.page?.cursor}`,
);
assert(
  'documents list: no meta.page.hasMore',
  dMeta.page?.hasMore === undefined,
  `unexpected ${dMeta.page?.hasMore}`,
);

console.log('\n[7] assets list: links.self per item');
const aList = await get('/assets/resources?filter%5Bprefix%5D=uploads');
assert('assets resources 200', aList.status === 200, `got ${aList.status} ${JSON.stringify(aList.body)}`);
const aItems = aList.body?.data ?? [];
assert(
  'every assets item has links.self',
  aItems.every((it) => typeof it.links?.self === 'string' && it.links.self.startsWith('/assets/resources/')),
  JSON.stringify(aItems.map(i => i.links)),
);

// --- teardown --------------------------------------------------------------
server.close();
await rm(ROOT, { recursive: true, force: true });

if (fails.length > 0) {
  console.error(`\n${fails.length} assertion(s) failed:`, fails);
  process.exit(1);
}
console.log('\nAll assertions passed.');
process.exit(0);
