/**
 * Multiple-collection Decap CMS config.
 *
 * minimalBlogConfig() creates one collection ('posts' by default).
 * extraCollections adds additional collections using the same Decap YAML
 * shape — here a 'projects' portfolio collection and a 'pages' files
 * collection (singleton About page).
 *
 * The Decap config is a plain JS object — no YAML file, no angular, just JSON.
 * createEmbeddedLaika seeds it to `${contentDir}/config.yml` on first run.
 */
import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const projectsCollection = {
  name: 'projects',
  label: 'Projects',
  folder: 'projects',
  create: true,
  slug: '{{slug}}',
  extension: 'md',
  fields: [
    { name: 'title', label: 'Title', widget: 'string' },
    { name: 'description', label: 'Short description', widget: 'text' },
    { name: 'url', label: 'Live URL', widget: 'string', required: false },
    { name: 'repo', label: 'Repo URL', widget: 'string', required: false },
    { name: 'tags', label: 'Tags', widget: 'list' },
    { name: 'body', label: 'Case study (Markdown)', widget: 'markdown' },
  ],
};

const pagesCollection = {
  name: 'pages',
  label: 'Pages',
  files: [
    {
      name: 'about',
      label: 'About',
      file: 'about.md',
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        { name: 'headline', label: 'One-line headline', widget: 'string' },
        { name: 'body', label: 'Bio (Markdown)', widget: 'markdown' },
      ],
    },
  ],
};

export const decapConfig = minimalBlogConfig({
  collectionName: 'blog',
  folder: 'blog',
  extraCollections: [projectsCollection, pagesCollection],
});

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
