import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'src/generated', 'jest*.config.js', 'eslint.config.mjs'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // INV-03: no unsafe raw SQL anywhere.
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Forbidden (ROADMAP §7.2). Use tagged $queryRaw.' },
        { property: '$executeRawUnsafe', message: 'Forbidden (ROADMAP §7.2). Use tagged $executeRaw.' },
        { object: 'process', property: 'env', message: 'Read configuration through AppConfigService.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tooling and tests may set/read the environment directly.
    files: ['prisma.config.ts', 'prisma/**/*.ts', 'src/common/observability/appinsights-bootstrap.ts', 'test/**/*.ts', 'src/**/*.spec.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
