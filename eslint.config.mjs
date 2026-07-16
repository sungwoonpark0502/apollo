import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/*.gen.*'] },
  {
    files: ['**/*.mjs', '**/*.config.*'],
    languageOptions: { globals: globals.node },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // I2 craft rule: all human-facing date/time/number formatting goes through
    // packages/shared/src/format.ts. Flag ad-hoc formatters everywhere else.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', 'packages/shared/src/format.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='toLocaleTimeString']",
          message: 'Use fmtTime/fmtDateTime from @apollo/shared format.ts instead of toLocaleTimeString.',
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message: 'Use fmtDate/fmtDateTime from @apollo/shared format.ts instead of toLocaleDateString.',
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message: 'Use format.ts helpers (fmtDateTime/fmtNumber) instead of toLocaleString for display.',
        },
        {
          selector: "CallExpression[callee.property.name='toFormat']",
          message: 'Use format.ts helpers (fmt*/icsDate/localDateKey) instead of luxon DateTime.toFormat.',
        },
        {
          selector: "CallExpression[callee.property.name='toRelative']",
          message: 'Use fmtRelative from @apollo/shared format.ts instead of luxon toRelative.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/scripts/**', 'eval/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/renderer/public/*.js'],
    languageOptions: {
      globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly' },
    },
  },
);
