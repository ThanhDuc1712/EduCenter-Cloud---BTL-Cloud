import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma CLI does not load .env automatically: read the repo-root .env (git-ignored) if present.
// Values already set in the process environment (CI, containers) take precedence.
loadEnv({ path: [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../../.env')], quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    // Migrations run as the schema owner (edu_migrator, D-25) — never as the runtime role.
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
