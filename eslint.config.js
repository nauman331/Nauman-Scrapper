import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    // Keep lint focused on bugs, without adding style or type-aware requirements.
    rules: {
      'no-unused-vars': 'off',
      'no-debugger': 'warn',
      'no-async-promise-executor': 'warn',
      'no-compare-neg-zero': 'error',
      'no-unsafe-finally': 'error',
      'no-unexpected-multiline': 'error',
      'valid-typeof': 'error',
    },
  },
];
