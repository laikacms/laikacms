import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { negotiateLocale } from './i18n.js';
import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);
const SUPPORTED = ['en', 'nl', 'de'] as const;
const FALLBACK_LOCALE = 'en';

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS i18n starter' });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-i18n',
    supportedLocales: SUPPORTED,
    fallbackLocale: FALLBACK_LOCALE,
    endpoints: {
      'GET /': 'this index',
      'GET /posts?lang=…': 'list posts in a specific language (honors Accept-Language if no ?lang)',
      'GET /posts/:slug?lang=…': 'single post; falls back through SUPPORTED if missing',
      'GET /admin': 'Decap CMS admin shell',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

function pickLocale(
  c: { req: { header: (k: string) => string | undefined, query: (k: string) => string | undefined } },
): string {
  const explicit = c.req.query('lang');
  if (explicit && SUPPORTED.includes(explicit as (typeof SUPPORTED)[number])) return explicit;
  return negotiateLocale(c.req.header('accept-language') ?? null, SUPPORTED, FALLBACK_LOCALE);
}

app.get('/posts', async c => {
  const locale = pickLocale(c);
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );

  // Filter to documents in the negotiated locale. Documents whose `language`
  // field matches; if there are no matches, fall back to all and let the
  // single-document handler do per-doc fallbacks.
  const matching = items
    .filter(i => i.type === 'published')
    .filter(item => {
      const lang = (item as { language?: string }).language;
      return !lang || lang.toLowerCase().startsWith(locale.toLowerCase());
    })
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const key = (item as { key: string }).key;
      return {
        key,
        slug: key.replace(/^posts\//, '').replace(/\.md$/, ''),
        language: (item as { language?: string }).language ?? locale,
        title: (content.title as string) ?? null,
        date: (content.date as string) ?? null,
      };
    });

  return c.json({ locale, posts: matching });
});

app.get('/posts/:slug', async c => {
  const slug = c.req.param('slug');
  const preferred = pickLocale(c);

  // Try the preferred locale first; fall back through the rest of SUPPORTED.
  // This shape only works if your slugs are global (same `posts/<slug>` key
  // across languages). For per-locale-folder layout, swap to
  // `posts/${locale}/${slug}` in the loop below.
  const order = [preferred, ...SUPPORTED.filter(l => l !== preferred)];

  for (const locale of order) {
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
      const docLang = (doc as { language?: string }).language;
      if (!docLang || docLang.toLowerCase().startsWith(locale.toLowerCase())) {
        const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
          string,
          unknown
        >;
        return c.json({
          locale,
          requestedLocale: preferred,
          post: { slug, language: docLang ?? locale, content },
        });
      }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  return c.json({ error: 'Not found', requestedLocale: preferred }, 404);
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS i18n backend listening on http://localhost:${info.port}`);
});
