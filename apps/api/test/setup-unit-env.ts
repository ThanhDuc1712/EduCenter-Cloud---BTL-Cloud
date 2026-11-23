import 'reflect-metadata';
// Deterministic, secret-free environment for tests that never touch a database.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'fatal';
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.DATABASE_URL = 'postgresql://edu_runtime:unit-test-no-db@127.0.0.1:1/educenter_unit';
process.env.JSON_BODY_LIMIT = '1kb';
process.env.INTERNAL_BODY_LIMIT = '2kb';
