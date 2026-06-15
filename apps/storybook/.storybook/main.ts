import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

/**
 * Absolute path to a workspace package's `src` directory.
 *
 * This file lives in `apps/storybook/.storybook`, so `../../../packages` points
 * at the repo's `packages` directory.
 */
function packageSrc(relativePackagePath: string): string {
  return fileURLToPath(new URL(`../../../packages/${relativePackagePath}/src`, import.meta.url));
}

const lexicalEditorSrc = packageSrc('lexical-editor');
const lexicalSrc = packageSrc('decap-cms-widget-lexicaleditor');
const portableTextEditorSrc = packageSrc('decap-cms-widget-portabletext-editor');
const decapSrc = packageSrc('decap');
const decapAiSrc = packageSrc('decap-ai');
const portableTextCoreSrc = packageSrc('portable-text/portabletext-core');

/**
 * Resolve the workspace packages to their TypeScript source instead of their
 * built `dist`. Stories import the packages through their real public
 * specifiers (e.g. `@laikacms/lexical-editor/editor/ui/button`); these
 * aliases redirect those specifiers to source so Storybook renders from source
 * with HMR and without requiring the packages to be built first.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: config =>
    mergeConfig(config, {
      resolve: {
        alias: [
          { find: /^@laikacms\/lexical-editor$/, replacement: `${lexicalEditorSrc}/index.ts` },
          { find: /^@laikacms\/lexical-editor\/core$/, replacement: `${lexicalEditorSrc}/core/index.ts` },
          { find: /^@laikacms\/lexical-editor\/(.*)$/, replacement: `${lexicalEditorSrc}/$1` },
          { find: /^decap-cms-widget-lexicaleditor$/, replacement: `${lexicalSrc}/index.ts` },
          { find: /^decap-cms-widget-lexicaleditor\/(.*)$/, replacement: `${lexicalSrc}/$1` },
          { find: /^decap-cms-widget-portabletext-editor$/, replacement: `${portableTextEditorSrc}/index.ts` },
          { find: /^decap-cms-widget-portabletext-editor\/(.*)$/, replacement: `${portableTextEditorSrc}/$1` },
          { find: /^@laikacms\/decap-integrations\/(.*)$/, replacement: `${decapSrc}/$1` },
          { find: /^@laikacms\/decap-ai$/, replacement: `${decapAiSrc}/index.ts` },
          { find: /^@laikacms\/decap-ai\/(.*)$/, replacement: `${decapAiSrc}/$1` },
          { find: /^@laikacloud\/portabletext-core$/, replacement: `${portableTextCoreSrc}/index.ts` },
          { find: /^@laikacloud\/portabletext-core\/(.*)$/, replacement: `${portableTextCoreSrc}/$1` },
        ],
      },
    }),
};

export default config;
