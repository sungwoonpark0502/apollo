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
