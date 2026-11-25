import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { MaterialCallbackController } from './callback.controller';
import { MaterialsController } from './materials.controller';
import { MaterialsService, PROCESSING_DISPATCHER } from './materials.service';
import { AliyunFcDispatcher, LocalProcessingDispatcher } from './processing.dispatchers';
import { MaterialReconciler } from './reconciler.service';

/** Processing provider selected by PROCESSING_PROVIDER (local = MOCK worker, aliyun-fc = Function Compute). */
@Module({
  controllers: [MaterialsController, MaterialCallbackController],
  providers: [
    MaterialsService,
    MaterialReconciler,
    LocalProcessingDispatcher,
    AliyunFcDispatcher,
    {
      provide: PROCESSING_DISPATCHER,
      inject: [AppConfigService, LocalProcessingDispatcher, AliyunFcDispatcher],
      useFactory: (config: AppConfigService, local: LocalProcessingDispatcher, fc: AliyunFcDispatcher) => (config.get('PROCESSING_PROVIDER') === 'aliyun-fc' ? fc : local),
    },
  ],
  exports: [MaterialsService, MaterialReconciler, PROCESSING_DISPATCHER, LocalProcessingDispatcher],
})
export class MaterialsModule {}
