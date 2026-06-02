import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { collectStream } from 'laikacms/compat';

import { type FeedMeta, type FeedPost, renderAtom, renderJsonFeed, renderRss2, renderSitemap } from './feeds.js';
import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);
const SITE_URL = process.env.SITE_URL ?? `http://localhost:${PORT}`;

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS RSS starter' });

const META: FeedMeta = {
  title: 'LaikaCMS RSS starter',
  description: 'A reference blog feed powered by LaikaCMS.',
  siteUrl: SITE_URL,
  feedUrl: `${SITE_URL}/rss.xml`,
  language: 'en',
  author: { name: 'LaikaCMS Author', email: 'author@example.com' },
};

async function loadPosts(): Promise<FeedPost[]> {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return items
    .filter(i => i.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const key = (item as { key: string }).key;
      const slug = key.replace(/^posts\//, '').replace(/\.md$/, '');
      return {
        slug,
        title: (content.title as string) ?? slug,
        url: `${SITE_URL}/posts/${slug}`,
        date: (content.date as string) ?? (item as { updatedAt?: string }).updatedAt ?? null,
        body: (content.body as string) ?? '',
      };
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-rss',
    feeds: {
      rss: `${SITE_URL}/rss.xml`,
      atom: `${SITE_URL}/atom.xml`,
      json: `${SITE_URL}/feed.json`,
      sitemap: `${SITE_URL}/sitemap.xml`,
    },
    discoveryHints:
      'Add `<link rel="alternate" type="application/rss+xml" href="/rss.xml">` (and equivalents) in your site head so readers auto-discover the feeds.',
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/rss.xml', async c => {
  const posts = await loadPosts();
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  return c.body(renderRss2(posts, META));
});

app.get('/atom.xml', async c => {
  const posts = await loadPosts();
  c.header('Content-Type', 'application/atom+xml; charset=utf-8');
  return c.body(renderAtom(posts, META));
});

app.get('/feed.json', async c => {
  const posts = await loadPosts();
  return c.json(
    renderJsonFeed(posts, { ...META, feedUrl: `${SITE_URL}/feed.json` }) as Record<string, unknown>,
  );
});

app.get('/sitemap.xml', async c => {
  const posts = await loadPosts();
  c.header('Content-Type', 'application/xml; charset=utf-8');
  return c.body(renderSitemap(posts, SITE_URL));
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS RSS backend listening on http://localhost:${info.port}`);
});
