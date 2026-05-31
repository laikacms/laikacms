/**
 * Vue 3 SSR blog server — bare metal, no Nuxt/Vite.
 *
 * What this demonstrates (what Nuxt abstracts away):
 *   - @vue/server-renderer renderToString: converts a VNode tree to HTML string
 *   - h() createElement: build component trees without .vue SFCs or a compiler
 *   - Server-side data fetching: laika.documents.* resolved before renderToString
 *
 * The client never receives Vue — this is pure server-rendered HTML with no
 * hydration. For a full SSR+hydration setup you would also bundle a client
 * entry that calls createApp().mount('#app').
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { renderToString } from '@vue/server-renderer';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { h, type VNode } from 'vue';

import { laika } from './laika.js';

const app = new Hono();

// --- Vue components (h() instead of .vue SFCs — no compile step needed) ----

function Layout(props: { title: string, children: VNode | VNode[] }) {
  return h('html', { lang: 'en' }, [
    h('head', [
      h('meta', { charset: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }),
      h('title', props.title),
      h(
        'style',
        `
        body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
        a { color: #0070f3; }
        nav { margin-bottom: 2rem; }
        .post-list { list-style: none; padding: 0; }
        .post-list li { margin-bottom: 1rem; }
        time { color: #666; font-size: 0.875rem; margin-left: 0.5rem; }
      `,
      ),
    ]),
    h('body', [
      h('nav', [h('a', { href: '/' }, 'Home'), ' · ', h('a', { href: '/admin/' }, 'Admin')]),
      props.children,
    ]),
  ]);
}

function BlogListPage(props: { posts: Array<{ slug: string, updatedAt?: string }> }) {
  const items = props.posts.map(post =>
    h('li', [
      h('a', { href: `/blog/${post.slug}` }, post.slug),
      post.updatedAt
        ? h('time', new Date(post.updatedAt).toLocaleDateString())
        : null,
    ])
  );

  const body = props.posts.length === 0
    ? h('p', [
      'No posts yet. ',
      h('a', { href: '/admin/' }, 'Open the CMS'),
      ' to write your first post.',
    ])
    : h('ul', { class: 'post-list' }, items);

  return h(Layout, { title: 'My Blog', children: [h('h1', 'My Blog'), body] });
}

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

function BlogPostPage(props: { slug: string, post: PostContent }) {
  const { title, date, description, body } = props.post;
  return h(Layout, {
    title: title ?? props.slug,
    children: h('article', [
      h('h1', title ?? props.slug),
      date ? h('time', new Date(date).toLocaleDateString()) : null,
      description ? h('p', h('em', description)) : null,
      h('pre', { style: 'white-space:pre-wrap;font-family:inherit' }, body ?? ''),
      h('p', h('a', { href: '/' }, '← Back')),
    ]),
  });
}

function NotFoundPage() {
  return h(Layout, { title: 'Not Found', children: [h('h1', '404'), h('p', 'Page not found.')] });
}

// --- Routes ----------------------------------------------------------------

// Decap JSON:API — forward all /api/decap/* to the embedded laika handler.
// c.req.raw is the WHATWG Request that laika.fetch expects — no bridging needed.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Blog index — list published posts.
app.get('/', async c => {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = records
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? undefined,
    }));

  // renderToString resolves the VNode tree to an HTML string.
  // No client-side Vue runtime is shipped — this is pure static HTML.
  const html = await renderToString(h(BlogListPage, { posts }));
  return c.html(`<!doctype html>${html}`);
});

// Individual blog post.
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();

  let post: PostContent;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    post = doc.content as PostContent;
  } catch {
    const html = await renderToString(h(NotFoundPage));
    return c.html(`<!doctype html>${html}`, 404);
  }

  const html = await renderToString(h(BlogPostPage, { slug, post }));
  return c.html(`<!doctype html>${html}`);
});

// Static files — serves /admin/index.html, /admin/bundle.js, /uploads/*, etc.
app.use('/*', serveStatic({ root: './public' }));

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Vue SSR blog running at http://localhost:${info.port}`);
  console.log(`  Blog:  http://localhost:${info.port}/`);
  console.log(`  Admin: http://localhost:${info.port}/admin/`);
});
