import type { AppConfigService } from '../../common/config/app-config.service';
import type { DemoContextService } from '../../common/context/demo-context.service';
import type { Principal } from '../../common/context/principal';

/** Body of `GET /context` — also returned by login / register so the SPA can start right away. */
export function contextPayload(p: Principal, demo: DemoContextService, config: AppConfigService) {
  return {
    principal: p,
    demoMode: demo.demoMode,
    authMode: config.get('AUTH_MODE'),
    mode: {
      storage: config.get('STORAGE_PROVIDER'),
      processing: config.get('PROCESSING_PROVIDER'),
      environment: config.get('NODE_ENV'),
    },
  };
}
