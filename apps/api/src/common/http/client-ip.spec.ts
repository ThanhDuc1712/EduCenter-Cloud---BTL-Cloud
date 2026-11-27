import { normalizeClientIp } from './client-ip';

describe('normalizeClientIp (behind Azure App Service)', () => {
  it.each([
    ['1.53.222.92:51234', '1.53.222.92'], // App Service X-Forwarded-For carries the client port
    ['1.53.222.92', '1.53.222.92'],
    ['::ffff:10.0.0.4', '10.0.0.4'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeClientIp(input)).toBe(expected);
  });
});
