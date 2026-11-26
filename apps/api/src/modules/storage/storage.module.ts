import { Global, Module } from '@nestjs/common';
import path from 'node:path';
import { AppConfigService } from '../../common/config/app-config.service';
import { AppLogger } from '../../common/logging/app-logger';
import { TelemetryService } from '../../common/observability/telemetry.service';
import { LocalStorageController } from './local-storage.controller';
import { LocalStorageProvider } from './local-storage.provider';
import { OssStorageProvider } from './oss-storage.provider';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';

/** Picks the storage implementation from STORAGE_PROVIDER (local | oss). */
export function createStorageProvider(config: AppConfigService, telemetry: TelemetryService, logger: AppLogger): StorageProvider {
  if (config.get('STORAGE_PROVIDER') === 'oss') {
    const required = ['ALIYUN_REGION', 'OSS_QUARANTINE_BUCKET', 'OSS_PUBLISHED_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'] as const;
    const missing = required.filter((k) => !config.get(k));
    if (missing.length) throw new Error(`STORAGE_PROVIDER=oss requires: ${missing.join(', ')}`);
    logger.event('log', 'storage.provider', { provider: 'OSS', region: config.get('ALIYUN_REGION') }, 'Storage');
    return new OssStorageProvider(
      {
        region: config.get('ALIYUN_REGION')!,
        quarantineBucket: config.get('OSS_QUARANTINE_BUCKET')!,
        publishedBucket: config.get('OSS_PUBLISHED_BUCKET')!,
        accessKeyId: config.get('OSS_ACCESS_KEY_ID')!,
        accessKeySecret: config.get('OSS_ACCESS_KEY_SECRET')!,
        internal: config.get('OSS_INTERNAL_ENDPOINT'),
      },
      telemetry,
    );
  }
  const root = path.resolve(process.cwd(), config.get('LOCAL_STORAGE_DIR'));
  logger.event('log', 'storage.provider', { provider: 'LOCAL', root }, 'Storage');
  return new LocalStorageProvider(root, config.get('DEMO_CONTEXT_SECRET'));
}

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [{ provide: STORAGE_PROVIDER, inject: [AppConfigService, TelemetryService, AppLogger], useFactory: createStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
