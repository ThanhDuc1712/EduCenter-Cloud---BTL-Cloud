import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { POLICY_METADATA } from '../src/common/authz/policy.decorator';

/**
 * Route inventory (INV-02): every route registered in AppModule must declare a policy.
 * P1-03 extends this to the full policy set (@Policy / @InternalHmacPolicy).
 */
describe('Route inventory', () => {
  it('every controller route in AppModule declares a policy', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const container = moduleRef.get(ModulesContainer);

    const routes: { route: string; hasPolicy: boolean }[] = [];
    for (const mod of container.values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
        if (!ctrl) continue;
        const classPolicy = Reflect.getMetadata(POLICY_METADATA, ctrl);
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const handler = (ctrl.prototype as Record<string, unknown>)[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          const path = `${Reflect.getMetadata(PATH_METADATA, ctrl)}/${Reflect.getMetadata(PATH_METADATA, handler)}`;
          routes.push({ route: `${ctrl.name}.${name} (${path})`, hasPolicy: Boolean(Reflect.getMetadata(POLICY_METADATA, handler) ?? classPolicy) });
        }
      }
    }

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !r.hasPolicy).map((r) => r.route)).toEqual([]);
    await moduleRef.close();
  });
});
