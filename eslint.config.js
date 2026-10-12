import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Globální objekty prohlížeče, které čisté jádro nesmí používat. */
const domGlobals = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'Worker',
  'self',
  'postMessage',
  'HTMLElement',
  'Element',
  'Node',
  'Blob',
  'File',
  'FileReader',
  'URL',
].map((name) => ({ name, message: 'src/core je čisté jádro – bez DOM a prohlížečových API.' }));

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      'tests/fixtures',
      '.claude',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.es2022 },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(react|react-dom|zustand|dexie|comlink)(/.*)?$',
              message:
                'src/core nesmí importovat React ani knihovny UI, stavu, workeru a úložiště.',
            },
            {
              regex: '^(\\.\\./)+(ui|state|worker|storage|app)(/.*)?$',
              message:
                'src/core nesmí importovat z src/ui, src/state, src/worker, src/storage ani src/app.',
            },
            {
              regex: '^(@/|/?src/)(ui|state|worker|storage|app)(/.*)?$',
              message:
                'src/core nesmí importovat z src/ui, src/state, src/worker, src/storage ani src/app.',
            },
            {
              regex: '^node:',
              message: 'src/core běží v prohlížeči – bez vestavěných modulů Node.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...domGlobals],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
