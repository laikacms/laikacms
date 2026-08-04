import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Laika CMS',
  description: 'Modular, runtime-agnostic content management software for your own custom or existing UIs.',
  // Served at laikacms.com/docs/ alongside the marketing site (see the
  // laika-cloud repo, ADR-0028). `pnpm build:site` at the workspace root
  // assembles apps/website/dist + this dist into one Cloudflare Pages deploy.
  base: '/docs/',
  cleanUrls: true,
  lastUpdated: true,
  // The apps/ tree was moved out of the monorepo (June 2026).
  // Any lingering ../apps/ references point at external source dirs, not vitepress pages.
  ignoreDeadLinks: [/\/apps\//],
  themeConfig: {
    nav: [
      { text: 'Guides', link: '/guides/getting-started', activeMatch: '/guides/' },
      { text: 'Concepts', link: '/concepts/', activeMatch: '/concepts/' },
      { text: 'Reference', link: '/reference/json-api/', activeMatch: '/reference/' },
      { text: 'Contributing', link: '/contributing/', activeMatch: '/contributing/' },
    ],
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'Overview', link: '/guides/' },
          { text: 'Getting Started', link: '/guides/getting-started' },
          { text: 'Deployment', link: '/guides/deployment' },
          { text: 'Security', link: '/guides/security' },
          {
            text: 'Decap CMS',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/guides/decap/' },
              { text: 'Quickstart: FileSystem + Decap', link: '/guides/decap/quickstart-fs' },
              { text: 'Standalone Worker', link: '/guides/decap/standalone-worker' },
              { text: 'Serving the Admin Shell', link: '/guides/decap/admin-shell' },
              { text: 'Authentication', link: '/guides/decap/auth' },
              { text: 'Widgets & Editor Components', link: '/guides/decap/widgets-and-editors' },
              { text: 'Framework Setup Notes', link: '/guides/decap/frameworks' },
            ],
          },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Overview', link: '/concepts/' },
          { text: 'Architecture', link: '/concepts/architecture' },
          { text: 'Repositories', link: '/concepts/repositories' },
          { text: 'Content Model', link: '/concepts/content-model' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Overview', link: '/reference/' },
          {
            text: 'JSON:API',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/reference/json-api/' },
              { text: 'Storage API', link: '/reference/json-api/storage' },
              { text: 'Documents API', link: '/reference/json-api/documents' },
              { text: 'Assets API', link: '/reference/json-api/assets' },
              { text: 'ContentBase API', link: '/reference/json-api/contentbase' },
              { text: 'Error Responses', link: '/reference/json-api/errors' },
            ],
          },
          { text: 'Packages', link: '/reference/packages' },
          { text: 'Glossary', link: '/reference/glossary' },
        ],
      },
      {
        text: 'Contributing',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/contributing/' },
          { text: 'Starter Templates', link: '/contributing/starters' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/laikacms/laikacms' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/laikacms/laikacms/edit/develop/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Laika CMS contributors',
    },
  },
});
