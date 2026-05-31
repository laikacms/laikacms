import { serve } from '@hono/node-server';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

const PORT = Number(process.env.PORT ?? 3000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const decapConfig = minimalBlogConfig();

const storage = new GithubStorageRepository({
  appId: requireEnv('GITHUB_APP_ID'),
  privateKey: requireEnv('GITHUB_PRIVATE_KEY').replace(/\\n/g, '\n'),
  installationId: requireEnv('GITHUB_INSTALLATION_ID'),
  owner: requireEnv('GITHUB_OWNER'),
  repo: requireEnv('GITHUB_REPO'),
  branch: process.env.GITHUB_BRANCH ?? 'main',
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  defaultFileExtension: 'md',
  commitAuthor: {
    name: process.env.COMMIT_AUTHOR_NAME ?? 'LaikaCMS',
    email: process.env.COMMIT_AUTHOR_EMAIL ?? 'laikacms@bot.local',
  },
});

const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS GitHub-storage starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-github-storage',
    storage: `GitHub: ${requireEnv('GITHUB_OWNER')}/${requireEnv('GITHUB_REPO')}@${
      process.env.GITHUB_BRANCH ?? 'main'
    }`,
    note: 'Every write commits to the configured GitHub repo via the GitHub App.',
    endpoints: {
      'GET /': 'this index',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
      'GET /posts': 'public list of published posts',
      'GET /posts/:slug': 'public single-post endpoint',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/posts', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return c.json({
    posts: items
      .filter(item => item.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  });
});

app.get('/posts/:slug', async c => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS GitHub-storage backend listening on http://localhost:${info.port}`);
});
