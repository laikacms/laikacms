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
    ignores: [
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
      'types/**',
      // Framework-generated artifact directories — never manually edited
      '**/.astro/**',
      '**/.next/**',
      '**/.svelte-kit/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.vinxi/**',
      // Built static assets (esbuild bundles, etc.)
      '**/public/admin/bundle.js',
    ],
  },
);
