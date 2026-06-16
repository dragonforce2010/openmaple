import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'output/**',
      'artifacts/**',
      'infra/**',
      'migrations/**',
      'tests/**',
      '.managed-agents/**',
      '.codegraph/**',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.js',
    ],
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'agents/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    // react-hooks registered so existing inline `eslint-disable react-hooks/*`
    // directives resolve; rules left off - this gate is max-lines only.
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
    },
  }
];
