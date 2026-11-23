/** Unit + HTTP foundation tests — no database required. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/integration/'],
  // Type-checking is done by `tsc` (pnpm typecheck); ts-jest only transpiles here.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  // The generated Prisma client uses ESM-style '.js' specifiers that point at TS sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/test/setup-unit-env.ts'],
};
