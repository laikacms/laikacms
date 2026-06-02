import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Laika CMS',
  description: 'Modular, runtime-agnostic content management software for your own custom or existing UIs.',
  cleanUrls: true,
  lastUpdated: true,
  // starters.md links into ../apps/starter-* (the source dirs on disk / GitHub),
  // not into vitepress pages — those are intentionally not built as docs.
  ignoreDeadLinks: [/\/apps\//],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'API', link: '/api-reference' },
      { text: 'Packages', link: '/packages' },
      {
        text: 'More',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Repositories', link: '/repositories' },
          { text: 'Decap Integration', link: '/decap-integration' },
          { text: 'Deployment', link: '/deployment' },
          { text: 'Security', link: '/SECURITY' },
          { text: 'Security Audit (2026-05)', link: '/security-audit-2026-05' },
          { text: 'Test Strategy', link: '/test-strategy' },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Architecture', link: '/architecture' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api-reference' },
          { text: 'Packages', link: '/packages' },
          { text: 'Repositories', link: '/repositories' },
        ],
      },
      {
        text: 'Integrations',
        items: [
          { text: 'Decap CMS', link: '/decap-integration' },
          { text: 'Deployment', link: '/deployment' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Security', link: '/SECURITY' },
          { text: 'Security Audit 2026-05', link: '/security-audit-2026-05' },
          { text: 'Test Strategy', link: '/test-strategy' },
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
