/**
 * Portfolio site server — Hono + hono/jsx + LaikaCMS multi-collection.
 *
 * Two content collections served:
 *   /projects           list of portfolio projects
 *   /projects/:slug     single project with case study
 *   /blog               list of blog posts
 *   /blog/:slug         single post
 *   /about              singleton About page (Decap 'files' collection)
 *   /admin              Decap CMS admin shell (all three collections appear)
 *   /api/decap/*        LaikaCMS JSON:API (proxied to laika.fetch)
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { decapConfig, laika } from './laika.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const adminHtml = decapAdminHtml({ decapConfig });

const app = new Hono();

// ── Layout ─────────────────────────────────────────────────────────────────

function Layout({ title, children }: { title: string, children: unknown }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
          nav { display: flex; gap: 1.5rem; margin-bottom: 2rem; border-bottom: 1px solid #eee; padding-bottom: 1rem; }
          nav a { color: inherit; font-weight: 500; }
          ul { list-style: none; padding: 0; }
          li { margin-bottom: 1rem; }
          .tags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
          .tag { background: #f0f0f0; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.8rem; }
          a { color: #0070f3; }
          pre { white-space: pre-wrap; font-family: inherit; }
        </style>
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/projects">Projects</a>
          <a href="/blog">Blog</a>
          <a href="/about">About</a>
          <a href="/admin" style="margin-left:auto;color:#888">Admin</a>
        </nav>
        ${children}
      </body>
    </html>`;
}

// ── Types ──────────────────────────────────────────────────────────────────

type Project = {
  title?: string,
  description?: string,
  url?: string,
  repo?: string,
  tags?: string[],
  body?: string,
};

type BlogPost = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

type AboutPage = {
  title?: string,
  headline?: string,
  body?: string,
};

// ── Routes ─────────────────────────────────────────────────────────────────

app.get('/', c => {
  return c.html(
    <Layout title="Portfolio">
      <h1>Welcome</h1>
      <p>
        A portfolio site powered by LaikaCMS with two content collections: <a href="/projects">Projects</a> and{' '}
        <a href="/blog">Blog</a>.
      </p>
      <p>
        Open the <a href="/admin">Decap admin</a> to add content — you&apos;ll see <strong>Projects</strong>,{' '}
        <strong>Blog</strong>, and <strong>Pages</strong> (About) in the sidebar.
      </p>
    </Layout>,
  );
});

// Projects list
app.get('/projects', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'projects',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  const projects = items
    .filter(d => d.type === 'published')
    .map(d => ({
      slug: d.key.replace(/^projects\//, '').replace(/\.md$/, ''),
      ...(d.content as Project),
    }));

  return c.html(
    <Layout title="Projects">
      <h1>Projects</h1>
      {projects.length === 0
        ? (
          <p>
            No projects yet. <a href="/admin">Open the CMS</a> and add one under &quot;Projects&quot;.
          </p>
        )
        : (
          <ul>
            {projects.map(p => (
              <li key={p.slug}>
                <a href={`/projects/${p.slug}`}>{p.title ?? p.slug}</a>
                {p.description && <p style="color:#555;margin:0.25rem 0">{p.description}</p>}
                {p.tags && p.tags.length > 0 && (
                  <div class="tags">
                    {p.tags.map(t => (
                      <span class="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </Layout>,
  );
});

// Single project
app.get('/projects/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`projects/${slug}`));
    const p = doc.content as Project;
    return c.html(
      <Layout title={p.title ?? slug}>
        <article>
          <h1>{p.title ?? slug}</h1>
          {p.description && (
            <p>
              <em>{p.description}</em>
            </p>
          )}
          <div class="tags">
            {(p.tags ?? []).map(t => (
              <span class="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
          {(p.url || p.repo) && (
            <p>
              {p.url && <a href={p.url} target="_blank" rel="noopener">Live ↗</a>}
              {p.url && p.repo && ' · '}
              {p.repo && <a href={p.repo} target="_blank" rel="noopener">Repo ↗</a>}
            </p>
          )}
          {p.body && <pre>{p.body}</pre>}
          <p>
            <a href="/projects">← Projects</a>
          </p>
        </article>
      </Layout>,
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.html(
        <Layout title="Not Found">
          <h1>404</h1>
          <p>Project not found.</p>
          <a href="/projects">← Projects</a>
        </Layout>,
        404,
      );
    }
    throw err;
  }
});

// Blog list
app.get('/blog', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'blog',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  const posts = items
    .filter(d => d.type === 'published')
    .map(d => ({
      slug: d.key.replace(/^blog\//, '').replace(/\.md$/, ''),
      ...(d.content as BlogPost),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  return c.html(
    <Layout title="Blog">
      <h1>Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin">Open the CMS</a> and add one under &quot;Blog&quot;.
          </p>
        )
        : (
          <ul>
            {posts.map(p => (
              <li key={p.slug}>
                <a href={`/blog/${p.slug}`}>{p.title ?? p.slug}</a>
                {p.date && <time style="color:#888;margin-left:0.5rem">{new Date(p.date).toLocaleDateString()}</time>}
                {p.description && <p style="color:#555;margin:0.25rem 0">{p.description}</p>}
              </li>
            ))}
          </ul>
        )}
    </Layout>,
  );
});

// Single post
app.get('/blog/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`blog/${slug}`));
    const p = doc.content as BlogPost;
    return c.html(
      <Layout title={p.title ?? slug}>
        <article>
          <h1>{p.title ?? slug}</h1>
          {p.date && <time style="color:#888">{new Date(p.date).toLocaleDateString()}</time>}
          {p.description && (
            <p>
              <em>{p.description}</em>
            </p>
          )}
          {p.body && <pre>{p.body}</pre>}
          <p>
            <a href="/blog">← Blog</a>
          </p>
        </article>
      </Layout>,
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.html(
        <Layout title="Not Found">
          <h1>404</h1>
          <p>Post not found.</p>
          <a href="/blog">← Blog</a>
        </Layout>,
        404,
      );
    }
    throw err;
  }
});

// About (files collection singleton at content/about.md)
app.get('/about', async c => {
  try {
    const doc = await runTask(laika.documents.getDocument('about'));
    const about = doc.content as AboutPage;
    return c.html(
      <Layout title={about.title ?? 'About'}>
        <h1>{about.title ?? 'About'}</h1>
        {about.headline && <p style="font-size:1.25rem">{about.headline}</p>}
        {about.body && <pre>{about.body}</pre>}
      </Layout>,
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.html(
        <Layout title="About">
          <h1>About</h1>
          <p>
            No about page yet. <a href="/admin">Open the CMS</a> → Pages → About to write one.
          </p>
        </Layout>,
      );
    }
    throw err;
  }
});

// Admin shell
app.get('/admin', c => c.html(adminHtml));

// LaikaCMS JSON:API — no body parser in the chain.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Static uploads
app.use('/uploads/*', serveStatic({ root: './public' }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Portfolio:    http://localhost:${PORT}`);
  console.log(`Projects:     http://localhost:${PORT}/projects`);
  console.log(`Blog:         http://localhost:${PORT}/blog`);
  console.log(`About:        http://localhost:${PORT}/about`);
  console.log(`Decap admin:  http://localhost:${PORT}/admin`);
});
