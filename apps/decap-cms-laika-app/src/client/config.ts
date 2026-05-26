/**
 * Inline Decap CMS configuration.
 *
 * v4.beta accepts a fully inlined config object passed to `CMS.init({ config })`
 * — no `admin/config.yml` required. We default to the GitHub backend using the
 * worker's `/auth/*` endpoints as the OAuth provider so the same deployment
 * works for self-hosted teams without spinning up Netlify's identity service.
 *
 * Edit the `repo`/`branch`/`collections` here to point at your real content
 * repo. The example collection below mounts both rich-text widgets so authors
 * can see them side-by-side.
 */
export const cmsConfig = {
  backend: {
    name: 'github',
    repo: 'your-org/your-content-repo',
    branch: 'main',
    base_url: '', // same origin as the SPA — the worker handles `/auth/*`
    auth_endpoint: 'auth',
  },
  publish_mode: 'editorial_workflow',
  media_folder: 'public/uploads',
  public_folder: '/uploads',
  collections: [
    {
      name: 'pages',
      label: 'Pages',
      folder: 'content/pages',
      create: true,
      slug: '{{slug}}',
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        {
          name: 'body_lexical',
          label: 'Body (Lexical-backed editor)',
          widget: 'lexicaleditor',
          format: 'markdown',
        },
        {
          name: 'body_pte',
          label: 'Body (PortableText editor)',
          widget: 'portabletext-editor',
          format: 'markdown',
        },
      ],
    },
    {
      name: 'posts',
      label: 'Posts',
      folder: 'content/posts',
      create: true,
      slug: '{{year}}-{{month}}-{{day}}-{{slug}}',
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        { name: 'date', label: 'Date', widget: 'datetime' },
        {
          name: 'body',
          label: 'Body',
          widget: 'lexicaleditor',
          format: 'markdown',
        },
      ],
    },
  ],
} as const;
