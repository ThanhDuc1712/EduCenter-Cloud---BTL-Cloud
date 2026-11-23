import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Real DATABASE_URL (edu_runtime) comes from the repo-root .env or the CI environment.
loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'fatal';
