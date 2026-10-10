import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const accessibilityWarnings = Object.fromEntries(
  Object.entries(jsxA11y.configs.recommended.rules).map(([rule, setting]) => [
    rule,
    Array.isArray(setting) ? ['warn', ...setting.slice(1)] : 'warn',
  ]),
);

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'server-python/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...accessibilityWarnings,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'jsx-a11y/label-has-for': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },
);
