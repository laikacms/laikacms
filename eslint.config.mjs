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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
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
      '**/tmp/**',
      '**/coverage/**',
      '**/build/**',
      '**/worker-configuration.d.ts',
      'types/**',
    ],
  },
);
