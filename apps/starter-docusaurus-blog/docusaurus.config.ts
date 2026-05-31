import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';

import laikaDecapPlugin from './src/laika-plugin.js';

const config: Config = {
  title: 'My Blog',
  tagline: 'Powered by Docusaurus and LaikaCMS',
  url: 'http://localhost:3000',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  plugins: [laikaDecapPlugin],

  presets: [
    [
      'classic',
      {
        blog: {
          showReadingTime: true,
          routeBasePath: '/',
          blogTitle: 'My Blog',
          blogDescription: 'A blog managed with LaikaCMS and Decap CMS',
          postsPerPage: 10,
        },
        docs: false,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'My Blog',
      items: [
        { href: '/admin/', label: 'Admin', position: 'right' },
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
