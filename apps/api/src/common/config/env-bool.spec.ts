import { validateEnv } from './env.validation';

const base = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://app.example',
  DATABASE_URL: 'postgresql://u:p@h:5432/d',
  DEMO_CONTEXT_SECRET: 'x'.repeat(48),
  CALLBACK_HMAC_KEYS: `k1:${'y'.repeat(48)}`,
};

describe('boolean env vars (App Service passes them as strings)', () => {
  it.each([
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['true', true],
  ])('REGISTRATION_ENABLED=%s -> %s', (raw, expected) => {
    expect(validateEnv({ ...base, REGISTRATION_ENABLED: raw }).REGISTRATION_ENABLED).toBe(expected);
  });

  it('keeps the default when unset', () => {
    expect(validateEnv(base).REGISTRATION_ENABLED).toBe(true);
  });
});
