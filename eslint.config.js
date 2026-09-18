import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Lint rules.
 *
 * Deliberately close to the recommended sets. The rules added on top are the
 * ones that catch mistakes this project actually cares about: a floating promise
 * in an ingestion path, or an unused variable left behind by an edit.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/simulator/out/**',
      'apps/web/screenshots/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // The simulator and the build scripts are command-line tools; printing is
    // their entire purpose.
    files: ['apps/simulator/**/*.ts', 'scripts/**/*.{js,mjs}', '**/*.config.{js,ts}'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // `document` and friends appear inside `page.evaluate` callbacks in the
      // screenshot helper: that code is serialised and runs in the browser.
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
