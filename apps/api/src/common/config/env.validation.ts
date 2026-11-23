import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUrl, Matches, Max, Min, validateSync } from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

const BYTE_SIZE = /^\d+(b|kb|mb)$/i;

/**
 * Validated environment. Secrets have NO defaults: a missing value stops the process.
 * Non-secret tunables have safe defaults.
 */
export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevelName = 'log';

  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  APP_ORIGIN: string;

  @IsString()
  @Matches(/^postgres(ql)?:\/\/[^\s]+$/, { message: 'DATABASE_URL must be a postgresql:// connection string' })
  DATABASE_URL: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  DB_CONNECTION_LIMIT: number = 10;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(30000)
  DB_HEALTH_TIMEOUT_MS: number = 2000;

  @Matches(BYTE_SIZE, { message: 'JSON_BODY_LIMIT must look like 1mb / 512kb' })
  JSON_BODY_LIMIT: string = '1mb';

  @Matches(BYTE_SIZE, { message: 'INTERNAL_BODY_LIMIT must look like 256kb' })
  INTERNAL_BODY_LIMIT: string = '256kb';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  SHUTDOWN_TIMEOUT_MS: number = 20000;
}

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration: ${problems.join('; ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Used by ConfigModule.forRoot({ validate }). Error messages name the variable and the
 * violated rule but NEVER echo the value (values may be secrets).
 */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const known = Object.keys(new EnvironmentVariables());
  const picked: Record<string, unknown> = {};
  for (const key of [...known, 'APP_ORIGIN', 'DATABASE_URL']) {
    if (raw[key] !== undefined && raw[key] !== '') picked[key] = raw[key];
  }

  const env = plainToInstance(EnvironmentVariables, picked, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false, forbidUnknownValues: true });
  if (errors.length > 0) {
    throw new EnvValidationError(
      errors.map((e) => `${e.property}: ${Object.keys(e.constraints ?? { invalid: '' }).join(', ')}`),
    );
  }
  return env;
}
