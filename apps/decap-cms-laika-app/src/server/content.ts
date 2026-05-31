import { Hono } from 'hono';

/**
 * Tiny public reader for the demo. Mounted ahead of the SPA so authored posts
 * surface at `/`, `/blog`, and `/blog/:slug`.
 *
 * Why `import.meta.glob` instead of `node:fs` — Cloudflare's `nodejs_compat`
 * deliberately omits the filesystem module (Workers have no disk), so doing
 * runtime reads of `./content/posts/*.md` would break in deploy and is shaky
 * even in dev. Vite's `import.meta.glob` resolves at bundle time, the worker
 * gets the markdown inlined, and `vite dev` hot-rebuilds the bundle whenever
 * the content directory changes — exactly the loop Playwright drives in e2e.
 *
 * In production the GitHub-backed Decap CMS commits content into the repo;
 * the CI build then re-runs and produces a fresh bundle with the new posts.
 */

const POST_FILES = import.meta.glob('../../content/posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface PostFrontmatter {
  title?: string;
  date?: string;
  [key: string]: unknown;
}

interface ParsedPost {
  slug: string;
  frontmatter: PostFrontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): { data: PostFrontmatter, body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: raw };
  const data: PostFrontmatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    data[key] = rawValue.replace(/^"|"$|^'|'$/g, '');
  }
  return { data, body: m[2] ?? '' };
}

const slugFromPath = (filePath: string): string => {
  const last = filePath.split('/').pop() ?? filePath;
  return last.replace(/\.md$/, '');
};

function getPosts(): ParsedPost[] {
  const out: ParsedPost[] = [];
  for (const [filePath, raw] of Object.entries(POST_FILES)) {
    const { data, body } = parseFrontmatter(raw);
    out.push({ slug: slugFromPath(filePath), frontmatter: data, body });
  }
  return out.sort((a, b) => String(b.frontmatter.date ?? '').localeCompare(String(a.frontmatter.date ?? '')));
}

function getPost(slug: string): ParsedPost | null {
  return getPosts().find(p => p.slug === slug) ?? null;
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const renderBody = (markdown: string): string =>
  markdown
    .split(/\r?\n\r?\n/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('# ')) return `<h1>${escape(trimmed.slice(2))}</h1>`;
      if (trimmed.startsWith('## ')) return `<h2>${escape(trimmed.slice(3))}</h2>`;
      return `<p>${escape(trimmed)}</p>`;
    })
    .filter(Boolean)
    .join('\n');

const shell = (title: string, body: string): string =>
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escape(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 24px; line-height: 1.6; color: #1f2937; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 32px; display: flex; gap: 16px; align-items: baseline; }
    header a { color: #374151; text-decoration: none; }
    header strong { font-size: 18px; }
    h1 { margin-top: 0; }
    ul.posts { list-style: none; padding: 0; }
    ul.posts li { padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
    ul.posts a { color: #0f172a; font-weight: 600; text-decoration: none; }
    time { color: #6b7280; font-size: 14px; margin-left: 12px; }
    a.cta { display: inline-block; margin-top: 12px; padding: 8px 14px; background: #0f172a; color: #fff; border-radius: 6px; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <strong>Laika CMS Demo</strong>
    <nav><a href="/">Home</a> · <a href="/blog">Blog</a> · <a href="/admin">Admin</a></nav>
  </header>
  ${body}
</body>
</html>
`;

export const contentRouter = new Hono();

contentRouter.get('/', c => {
  const posts = getPosts();
  const recent = posts.slice(0, 3);
  const body = `
    <h1>Laika CMS Demo</h1>
    <p>A content-bearing example wired to the local Decap CMS at <a href="/admin">/admin</a>.
       Posts authored in the CMS appear on the public <a href="/blog">/blog</a> page.</p>
    ${
    recent.length === 0
      ? '<p><em>No posts yet — try creating one in the admin.</em></p>'
      : `<h2>Recent posts</h2>
         <ul class="posts">${
        recent
          .map(p =>
            `<li><a href="/blog/${escape(p.slug)}" data-testid="post-link">${
              escape(String(p.frontmatter.title ?? p.slug))
            }</a><time>${escape(String(p.frontmatter.date ?? ''))}</time></li>`
          )
          .join('')
      }</ul>`
  }
    <p><a class="cta" href="/admin">Open the CMS</a></p>
  `;
  return c.html(shell('Laika CMS Demo', body));
});

contentRouter.get('/blog', c => {
  const posts = getPosts();
  const body = `
    <h1 data-testid="blog-heading">Blog</h1>
    <p>All posts authored through the CMS.</p>
    ${
    posts.length === 0
      ? '<p><em>No posts yet — try creating one in the admin.</em></p>'
      : `<ul class="posts" data-testid="blog-list">${
        posts
          .map(p =>
            `<li><a href="/blog/${escape(p.slug)}" data-testid="post-link">${
              escape(String(p.frontmatter.title ?? p.slug))
            }</a><time>${escape(String(p.frontmatter.date ?? ''))}</time></li>`
          )
          .join('')
      }</ul>`
  }
  `;
  return c.html(shell('Blog · Laika CMS Demo', body));
});

contentRouter.get('/blog/:slug', c => {
  const post = getPost(c.req.param('slug'));
  if (!post) return c.text('Not found', 404);
  const title = String(post.frontmatter.title ?? post.slug);
  const body = `
    <article>
      <h1 data-testid="post-title">${escape(title)}</h1>
      ${post.frontmatter.date ? `<time data-testid="post-date">${escape(String(post.frontmatter.date))}</time>` : ''}
      <div data-testid="post-body">${renderBody(post.body)}</div>
    </article>
    <p><a href="/blog">← back to all posts</a></p>
  `;
  return c.html(shell(`${title} · Laika CMS Demo`, body));
});
