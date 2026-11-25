import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Real DATABASE_URL (edu_runtime) comes from the repo-root .env or the CI environment.
loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'fatal';
// business.int-spec switches seeded personas through the demo context (PUT /context), so the
// suite runs in AUTH_MODE=demo. A login session still takes precedence (auth.int-spec).
process.env.AUTH_MODE = 'demo';
process.env.DEMO_MODE = 'true';
