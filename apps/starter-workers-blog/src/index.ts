/**
 * Cloudflare Workers + D1 blog starter for LaikaCMS.
 *
 * Unlike the Node.js starters (Astro, Next, Hono, Express) this app cannot use
 * `createEmbeddedLaika` — that helper hardcodes `FileSystemStorageRepository`
 * which requires `node:fs` and is incompatible with the Workers runtime.
 *
 * Instead we wire the lower-level `decapApi` by hand:
 *   D1StorageRepository (Cloudflare REST API)
 *   → DecapContentBaseSettingsProvider (reads Decap config from D1)
 *   → ContentBaseDocumentsRepository
 *   → ContentBaseAssetsRepository
 *   → decapApi({ documents, storage, assets, basePath, auth })
 *
 * Doc gap surfaced: there is no `createEmbeddedLaika` equivalent for edge
 * runtimes.  If you need one, open an issue at github.com/laikacms/laikacms.
 */
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { collectStream, runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import type { RecordSummary } from 'laikacms/documents';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { D1StorageRepository } from '@laikacms/cloudflare/storage-d1';
import { decapApi } from '@laikacms/decap-integrations/decap-api';

import { decapConfig } from './decap-config.js';

export interface Env {
  /** Cloudflare API token with D1:Edit permission — set via `wrangler secret put CF_API_TOKEN`. */
  CF_API_TOKEN: string;
  /** Cloudflare account ID — set via `wrangler secret put CF_ACCOUNT_ID`. */
  CF_ACCOUNT_ID: string;
  /** D1 database UUID — set via `wrangler secret put CF_D1_DATABASE_ID`. */
  CF_D1_DATABASE_ID: string;
  /** Optional override for the dev bearer token (defaults to 'dev-local-laika-token'). */
  DEV_TOKEN?: string;
}

const serializers = {
  md: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  txt: rawSerializer,
};

interface LaikaResources {
  api: ReturnType<typeof decapApi>;
  documents: ContentBaseDocumentsRepository;
}

// ── Per-isolate cache ─────────────────────────────────────────────────────────
// Workers re-use isolates across requests; cache the initialized API so we
// don't pay the D1 config round-trip on every single request.
let cached: LaikaResources | null = null;
let cachedApiToken = '';

async function getOrCreate(env: Env): Promise<LaikaResources> {
  // Invalidate if the token changed (e.g. secret rotation during dev).
  if (cached && cachedApiToken === env.CF_API_TOKEN) return cached;

  const storage = new D1StorageRepository({
    auth: { apiToken: env.CF_API_TOKEN },
    accountId: env.CF_ACCOUNT_ID,
    databaseId: env.CF_D1_DATABASE_ID,
    serializerRegistry: serializers,
    defaultFileExtension: 'md',
  });

  // Seed config.yml into D1 on first use so DecapContentBaseSettingsProvider
  // can read it.  Mirrors what createEmbeddedLaika does via ensureConfigOnDisk.
  await ensureConfig(storage);

  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  const documents = new ContentBaseDocumentsRepository(storage, settings);
  const assets = new ContentBaseAssetsRepository(storage, settings);

  const devToken = env.DEV_TOKEN ?? 'dev-local-laika-token';

  const api = decapApi({
    documents,
    storage,
    assets,
    basePath: '/api/decap',
    authenticateAccessToken: async token => {
      if (token !== devToken) throw new Error('Unauthorized');
      return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
    },
  });

  cached = { api, documents };
  cachedApiToken = env.CF_API_TOKEN;
  return cached;
}

/** Seed config.yml into D1 if it does not already exist. */
async function ensureConfig(storage: D1StorageRepository): Promise<void> {
  try {
    await runTask(storage.getObject('config.yml'));
    return; // already present
  } catch {
    // NotFoundError — seed it
  }
  try {
    // Pass the JS object — the yml serializer converts it to YAML for storage.
    await runTask(
      storage.createOrUpdateObject({
        key: 'config.yml',
        type: 'object',
        content: decapConfig as Record<string, unknown>,
      }),
    );
  } catch (err) {
    console.error('starter-workers-blog: failed to seed config.yml into D1', err);
  }
}

// ── Blog HTML helpers ─────────────────────────────────────────────────────────

function html(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
a{color:#0070f3}nav{margin-bottom:2rem}</style></head>
<body><nav><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

const adminHtml = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Blog Admin</title>
<script>window.CMS_MANUAL_INIT = true;</script>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
</head><body><script type="module">
const { default: createLaikaBackend } =
  await import('https://unpkg.com/@laikacms/decap-cms-backend-laika@latest/dist/index.js');
window.CMS.registerBackend('laika', createLaikaBackend());
window.CMS.init({ config: ${JSON.stringify(decapConfig)} });
</script></body></html>`;

// ── Worker entry point ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Decap JSON:API — proxy every method at /api/decap/*
    if (pathname.startsWith('/api/decap')) {
      const { api } = await getOrCreate(env);
      return api.fetch(request);
    }

    // Admin UI — served inline; Decap CMS loads from CDN
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      return new Response(adminHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Blog index — list published posts
    if (pathname === '/' || pathname === '') {
      const { documents } = await getOrCreate(env);
      try {
        const { items } = await collectStream(
          documents.listRecordSummaries({
            pagination: { page: 1, perPage: 100 },
            folder: 'posts',
            depth: 1,
            type: 'published',
          }),
        );

        const posts = (items as RecordSummary[])
          .filter(r => r.type === 'published-summary')
          .sort((a, b) => {
            const aTime = 'updatedAt' in a && a.updatedAt ? a.updatedAt : '';
            const bTime = 'updatedAt' in b && b.updatedAt ? b.updatedAt : '';
            if (aTime && bTime) return bTime.localeCompare(aTime);
            return b.key.localeCompare(a.key);
          });

        const listHtml = posts.length === 0
          ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`
          : `<ul style="list-style:none;padding:0">${
            posts.map(post => {
              const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
              const time = 'updatedAt' in post && post.updatedAt
                ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
                : '';
              return `<li style="margin-bottom:1.5rem"><a href="/blog/${slug}">${slug}</a>${time}</li>`;
            }).join('')
          }</ul>`;

        return html('My Blog', `<h1>My Blog</h1>${listHtml}`);
      } catch (err) {
        console.error('Error listing posts:', err);
        return html('My Blog', '<h1>My Blog</h1><p>Error loading posts.</p>');
      }
    }

    // Blog post — /blog/:slug
    const postMatch = pathname.match(/^\/blog\/([^/]+)\/?$/);
    if (postMatch) {
      const slug = postMatch[1];
      const { documents } = await getOrCreate(env);
      try {
        const post = await runTask(documents.getDocument(`posts/${slug}`));
        const data = post.content as Record<string, unknown>;
        const title = typeof data.title === 'string' ? data.title : slug;
        const body = typeof data.body === 'string' ? data.body : '';
        const date = typeof data.date === 'string'
          ? `<p><time>${new Date(data.date).toLocaleDateString()}</time></p>`
          : '';

        // Render markdown body as pre-formatted text (no renderer dependency).
        // Replace with a proper Markdown renderer for production.
        return html(
          title,
          `<article><h1>${title}</h1>${date}<div><pre style="white-space:pre-wrap">${body}</pre></div></article>
<p><a href="/">← Back</a></p>`,
        );
      } catch {
        return html('Not Found', '<h1>Post not found</h1><p><a href="/">← Back</a></p>');
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
