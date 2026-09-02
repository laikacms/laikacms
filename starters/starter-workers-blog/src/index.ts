/**
 * Cloudflare Workers + R2 blog starter for LaikaCMS.
 *
 * Unlike the Node.js starters (Astro, Next, Hono, Express) this app cannot use
 * `createEmbeddedLaika` — that helper hardcodes `FileSystemStorageRepository`
 * which requires `node:fs` and is incompatible with the Workers runtime.
 *
 * Instead we wire the lower-level `laikaApi` by hand:
 *   R2StorageRepository (native Cloudflare R2 binding)
 *   → DecapCatalogProvider (reads Decap config from R2)
 *   → CatalogDocumentsRepository
 *   → CatalogAssetsRepository
 *   → laikaApi({ documents, storage, assets, basePath, auth })
 *
 * Doc gap surfaced: there is no `createEmbeddedLaika` equivalent for edge
 * runtimes.  If you need one, open an issue at github.com/laikacms/laikacms.
 */
import { CatalogAssetsRepository } from 'laikacms/assets-catalog';
import { collectStream, runTask } from 'laikacms/compat';
import { DecapCatalogProvider } from 'laikacms/catalog-decap';
import { CatalogDocumentsRepository } from 'laikacms/documents-catalog';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { R2StorageRepository } from 'laikacms/storage/r2';

import { laikaApi } from '@laikacms/server/api';

import { decapConfig } from './decap-config.js';

export interface Env {
  /** R2 bucket binding — set via `[[r2_buckets]]` in wrangler.toml. */
  LAIKACMS_BUCKET: R2Bucket;
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
  api: ReturnType<typeof laikaApi>;
  documents: CatalogDocumentsRepository;
}

// ── Per-isolate cache ─────────────────────────────────────────────────────────
// Workers re-use isolates across requests; cache the initialized API so we
// don't pay the R2 config round-trip on every single request.
let cached: LaikaResources | null = null;

async function getOrCreate(env: Env): Promise<LaikaResources> {
  if (cached) return cached;

  const storage = new R2StorageRepository(env.LAIKACMS_BUCKET, serializers, 'md');

  // Seed config.yml into R2 on first use so DecapCatalogProvider
  // can read it.  Mirrors what createEmbeddedLaika does via ensureConfigOnDisk.
  await ensureConfig(storage);

  const settings = new DecapCatalogProvider({ storage, configKey: 'config' });
  const documents = new CatalogDocumentsRepository(storage, settings);
  const assets = new CatalogAssetsRepository(storage, settings);

  const devToken = env.DEV_TOKEN ?? 'dev-local-laika-token';

  const api = laikaApi({
    documents,
    storage,
    assets,
    basePath: '/api/decap',
    authenticateAccessToken: async token => {
      if (token !== devToken) throw new Error('Unauthorized');
      return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
    },
    authorize: () => true,
  });

  cached = { api, documents };
  return cached;
}

/** Seed config.yml into R2 if it does not already exist. */
async function ensureConfig(storage: R2StorageRepository): Promise<void> {
  try {
    await runTask(storage.getObject('config.yml'));
    return; // already present
  } catch {
    // NotFoundError — seed it
  }
  try {
    // metadata.extension: 'yml' forces yamlSerializer regardless of defaultFileExtension ('md'),
    // so the stored key in R2 is config.yml — matching what the log and comments say.
    await runTask(
      storage.createOrUpdateObject({
        key: 'config.yml',
        type: 'object',
        content: decapConfig as Record<string, unknown>,
        metadata: { extension: 'yml' },
      }),
    );
    console.log('starter-workers-blog: seeded config.yml into R2');
  } catch (err) {
    console.error('starter-workers-blog: failed to seed config.yml into R2', err);
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

// The bundle (bare, non-laika Decap app + the registrations in src/cms.ts +
// the config from src/admin-client.ts) is pre-built by esbuild
// (pnpm build:admin) and served as a Workers static asset from public/.
const adminHtml = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Blog Admin</title>
</head><body>
<script src="/admin/bundle.js" type="module"></script>
</body></html>`;

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
          documents.listRecords({
            pagination: { page: 1, perPage: 100 },
            folder: 'posts',
            depth: 1,
            type: 'published',
          }),
        );

        const posts = items
          .filter(r => r.type === 'published')
          .sort((a, b) => {
            if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
            return b.key.localeCompare(a.key);
          });

        const listHtml = posts.length === 0
          ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`
          : `<ul style="list-style:none;padding:0">${
            posts.map(post => {
              const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
              const title = typeof (post.content as Record<string, unknown>)?.['title'] === 'string'
                ? (post.content as Record<string, unknown>)['title'] as string
                : slug;
              const time = post.updatedAt
                ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
                : '';
              return `<li style="margin-bottom:1.5rem"><a href="/blog/${slug}">${title}</a>${time}</li>`;
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
