import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'apps/api/src/generated/**', 'test-results/**', 'playwright-report/**', '**/*.mjs', 'tests/load/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS entry points run under Node: declare its globals for them only (rules stay on, nothing is ignored).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', console: 'readonly', __dirname: 'readonly', __filename: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-restricted-syntax': ['error', { selector: "CallExpression[callee.property.name='$queryRawUnsafe']", message: 'Use parameterised $queryRaw tagged templates only.' }],
    },
  },
);
