/** Integration tests â€” require PostgreSQL (`pnpm db:up`) and a configured .env. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  // js first: some dependencies (ali-oss) ship .ts sources next to their compiled .js.
  moduleFileExtensions: ['js', 'ts', 'json'],
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/test/setup-integration-env.ts'],
  testTimeout: 20000,
};
