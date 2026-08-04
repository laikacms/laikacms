import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // 'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Marketing copy ships straight from apps/website (including the og-image
    // card): no em dashes in anything user-visible. Strings, template
    // literals and JSX text are covered; the .html files (index.html,
    // scripts/og-card.html) are outside ESLint's reach — keep those clean in
    // review.
    files: ['apps/website/**/*.{ts,tsx,js,jsx,mjs}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\u2014/]',
          message: 'No em dashes (—) in website copy; use a colon, comma, or restructure.',
        },
        {
          selector: 'TemplateElement[value.raw=/\\u2014/]',
          message: 'No em dashes (—) in website copy; use a colon, comma, or restructure.',
        },
        {
          selector: 'JSXText[value=/\\u2014/]',
          message: 'No em dashes (—) in website copy; use a colon, comma, or restructure.',
        },
      ],
    },
  },
  {
    ignores: [
      // Standalone examples workspace — not part of this pnpm project
      'examples/**',
      // Assembled apex site (website + docs) for Cloudflare Pages
      'site-dist/**',
      '**/dist/**',
      '**/dist-test/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      '**/.wrangler/**',
      '**/.vendor/**',
      '**/tmp/**',
      '**/coverage/**',
      '**/build/**',
      '**/worker-configuration.d.ts',
      '**/next-env.d.ts',
      // @laikacms/vite-plugin typegen output + its committed one-line reference
      '**/.laika/**',
      '**/laika-env.d.ts',
      'types/**',
      // Framework-generated artifact directories — never manually edited
      '**/.astro/**',
      '**/.next/**',
      '**/.svelte-kit/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.vinxi/**',
      '**/.cache/**',
      'apps/starter-gatsby-blog/public/**',
      // Built static assets (esbuild bundles, etc.)
      '**/public/admin/bundle.js',
      '**/static/admin/bundle.js',
      // Qwik framework server build output
      'apps/starter-qwik-blog/server/**',
      // Other framework-generated artifact directories
      '**/.marko-run/**',
      '**/.nitro/**',
    ],
  },
);
