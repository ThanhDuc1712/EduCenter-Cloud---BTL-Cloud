import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

export const STORAGE_PROVIDERS = ['local', 'oss'] as const;
export type StorageProviderName = (typeof STORAGE_PROVIDERS)[number];

export const PROCESSING_PROVIDERS = ['local', 'aliyun-fc'] as const;
export type ProcessingProviderName = (typeof PROCESSING_PROVIDERS)[number];

export const AUTH_MODES = ['session', 'demo'] as const;
export type AuthModeName = (typeof AUTH_MODES)[number];

const BYTE_SIZE = /^\d+(b|kb|mb)$/i;
/** `keyId:secret[,keyId:secret]` — secrets ≥ 32 chars; two keys may be valid during rotation (D-29). */
const HMAC_KEYS = /^[A-Za-z0-9_-]{1,32}:[^,\s]{32,}(,[A-Za-z0-9_-]{1,32}:[^,\s]{32,})?$/;
// Read the RAW value (obj[key]): with enableImplicitConversion class-transformer has already turned
// the string "false" into Boolean("false") === true before this transform runs.
const toBool = ({ obj, key, value }: { obj: Record<string, unknown>; key: string; value: unknown }) => {
  const raw = obj[key];
  if (typeof raw === 'string') return ['true', '1', 'yes'].includes(raw.trim().toLowerCase());
  return raw ?? value;
};

/**
 * Validated environment. Secrets have NO defaults: a missing value stops the process.
 * Non-secret tunables have safe defaults. Cloud settings are optional: when missing the matching
 * service is reported as NOT CONFIGURED and LOCAL providers are used.
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

  // ───── Authentication ─────
  /**
   * `session` (default): every non-public route needs a login session (POST /auth/login).
   * `demo`: requests without a session fall back to the I-01 demo context below (persona cookie /
   * DEMO_DEFAULT_PERSONA). For local demos and the existing integration / e2e scripts only.
   */
  @IsIn(AUTH_MODES)
  AUTH_MODE: AuthModeName = 'session';

  /** Public self-registration (creates a STUDENT account + student profile). */
  @Transform(toBool)
  @IsBoolean()
  REGISTRATION_ENABLED: boolean = true;

  /** Session idle timeout (minutes since the last request). */
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  SESSION_IDLE_MINUTES: number = 120;

  /** Session absolute lifetime (hours since login). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  SESSION_ABSOLUTE_HOURS: number = 24;

  // ───── Demo context (I-01; used only when AUTH_MODE=demo) ─────
  @Transform(toBool)
  @IsBoolean()
  DEMO_MODE: boolean = false;

  @Matches(/^[a-z0-9-]{2,64}$/, { message: 'DEMO_TENANT_SLUG must be a tenant slug' })
  DEMO_TENANT_SLUG: string = 'hanoi-center';

  /** Signs the demo persona cookie. Required (no default). */
  @IsString()
  @MinLength(32)
  DEMO_CONTEXT_SECRET: string;

  /** Persona used when no (valid) persona cookie is present. */
  @Matches(/^(admin|teacher:[A-Z0-9-]{1,32}|student:[A-Z0-9-]{1,32})$/, { message: 'DEMO_DEFAULT_PERSONA must be admin | teacher:<code> | student:<code>' })
  DEMO_DEFAULT_PERSONA: string = 'admin';

  /** Comma-separated CIDRs allowed to call /api/v1/cloud/* in production (I-02). Empty = deny in production. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  OPS_ALLOWED_CIDRS?: string = undefined;

  /** Serve the built SPA from the API (same-origin, D-03). Path relative to apps/api. */
  @IsOptional()
  @IsString()
  WEB_DIST_DIR?: string = undefined;

  // ───── Materials pipeline ─────
  @IsIn(STORAGE_PROVIDERS)
  STORAGE_PROVIDER: StorageProviderName = 'local';

  @IsIn(PROCESSING_PROVIDERS)
  PROCESSING_PROVIDER: ProcessingProviderName = 'local';

  @IsString()
  LOCAL_STORAGE_DIR: string = '.data/storage';

  /** Base URL the API uses to reach itself (local worker callback, local signed URLs). */
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  INTERNAL_BASE_URL: string = 'http://127.0.0.1:3000';

  @Matches(HMAC_KEYS, { message: 'CALLBACK_HMAC_KEYS must be keyId:secret[,keyId:secret] with secrets of at least 32 characters' })
  CALLBACK_HMAC_KEYS: string;

  /** Key ID the LOCAL worker signs with (Function Compute has its own copy of the key). */
  @Matches(/^[A-Za-z0-9_-]{1,32}$/)
  CALLBACK_HMAC_ACTIVE_KEY_ID: string = 'k1';

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(900)
  CALLBACK_MAX_SKEW_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1024)
  @Max(50 * 1024 * 1024)
  UPLOAD_MAX_BYTES: number = 10 * 1024 * 1024;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3600)
  UPLOAD_POLICY_TTL_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(3600)
  SIGNED_URL_TTL_SECONDS: number = 120;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  RECONCILE_INTERVAL_SECONDS: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(86400)
  PROCESSING_TIMEOUT_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  UPLOAD_EXPIRY_SECONDS: number = 1800;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  PROCESSING_MAX_ATTEMPTS: number = 3;

  // ───── Alibaba Cloud ─────
  @IsOptional() @IsString() ALIYUN_REGION?: string = undefined;
  @IsOptional() @IsString() ALIYUN_ACCOUNT_ID?: string = undefined;
  @IsOptional() @IsString() OSS_QUARANTINE_BUCKET?: string = undefined;
  @IsOptional() @IsString() OSS_PUBLISHED_BUCKET?: string = undefined;
  /** RAM user of the API (least privilege: PutObject policy signing, Get/Head/Delete, List). Never the root account. */
  @IsOptional() @IsString() OSS_ACCESS_KEY_ID?: string = undefined;
  @IsOptional() @IsString() OSS_ACCESS_KEY_SECRET?: string = undefined;
  @Transform(toBool) @IsBoolean() OSS_INTERNAL_ENDPOINT: boolean = false;
  @IsOptional() @IsString() ALIYUN_FC_FUNCTION_NAME?: string = undefined;
  @IsOptional() @IsString() ALIYUN_SLS_PROJECT?: string = undefined;
  @IsOptional() @IsString() ALIYUN_SLS_LOGSTORE?: string = undefined;
  /** Read-only RAM user for SLS / CloudMonitor queries (AliyunLogReadOnlyAccess, AliyunCloudMonitorReadOnlyAccess). */
  @IsOptional() @IsString() ALIYUN_READONLY_ACCESS_KEY_ID?: string = undefined;
  @IsOptional() @IsString() ALIYUN_READONLY_ACCESS_KEY_SECRET?: string = undefined;

  // ───── Azure ─────
  @IsOptional() @IsString() APPLICATIONINSIGHTS_CONNECTION_STRING?: string = undefined;
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] }) AZURE_KEY_VAULT_URL?: string = undefined;
  @IsOptional() @IsString() AZURE_SUBSCRIPTION_ID?: string = undefined;
  @IsOptional() @IsString() AZURE_RESOURCE_GROUP?: string = undefined;
  @IsOptional() @IsString() AZURE_APP_SERVICE_NAME?: string = undefined;
  @IsOptional() @IsString() AZURE_POSTGRES_SERVER_NAME?: string = undefined;
  @IsOptional() @IsString() AZURE_LOG_ANALYTICS_WORKSPACE_ID?: string = undefined;
  /** Set by App Service; presence means the process runs on App Service. */
  @IsOptional() @IsString() WEBSITE_SITE_NAME?: string = undefined;
  @IsOptional() @IsString() WEBSITE_INSTANCE_ID?: string = undefined;
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
  for (const key of new Set([...known, 'APP_ORIGIN', 'DATABASE_URL', 'DEMO_CONTEXT_SECRET', 'CALLBACK_HMAC_KEYS'])) {
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
