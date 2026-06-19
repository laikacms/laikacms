import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Laika CMS',
  description: 'Modular, runtime-agnostic content management software for your own custom or existing UIs.',
  cleanUrls: true,
  lastUpdated: true,
  // The apps/ tree was moved out of the monorepo (June 2026, see restructure-2026-06.md).
  // Any lingering ../apps/ references point at external source dirs, not vitepress pages.
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
          { text: 'Restructure (2026-06)', link: '/restructure-2026-06' },
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
          { text: 'Restructure 2026-06', link: '/restructure-2026-06' },
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
