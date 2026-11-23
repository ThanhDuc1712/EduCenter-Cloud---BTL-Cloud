import { EnvValidationError, validateEnv } from './env.validation';

const base = {
  APP_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://edu_runtime:s3cr3t-value@localhost:5432/educenter',
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies safe defaults', () => {
    const env = validateEnv({ ...base });
    expect(env.PORT).toBe(3000);
    expect(env.DB_CONNECTION_LIMIT).toBe(10);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces numeric strings', () => {
    const env = validateEnv({ ...base, PORT: '8080', DB_CONNECTION_LIMIT: '5' });
    expect(env.PORT).toBe(8080);
    expect(env.DB_CONNECTION_LIMIT).toBe(5);
  });

  it.each(['DATABASE_URL', 'APP_ORIGIN'])('throws when required %s is missing', (key) => {
    const raw: Record<string, unknown> = { ...base };
    delete raw[key];
    expect(() => validateEnv(raw)).toThrow(EnvValidationError);
    expect(() => validateEnv(raw)).toThrow(key);
  });

  it('rejects out-of-range values', () => {
    expect(() => validateEnv({ ...base, DB_CONNECTION_LIMIT: '1000' })).toThrow('DB_CONNECTION_LIMIT');
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow('NODE_ENV');
  });

  it('never echoes values (secrets) in the error message', () => {
    expect.assertions(2);
    try {
      validateEnv({ ...base, DATABASE_URL: 'mysql://root:topsecret@db/x' });
    } catch (err) {
      expect((err as Error).message).toContain('DATABASE_URL');
      expect((err as Error).message).not.toContain('topsecret');
    }
  });
});
