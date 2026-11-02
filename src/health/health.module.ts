import { Controller, Get } from '../decorators/controller.ts';
import { Module } from '../decorators/module.ts';
import { Public } from '../decorators/public.ts';
import { inject } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import type { HttpContext } from '../http/context.ts';
import { normalizePath } from '../http/router.ts';
import { HEALTH_OPTIONS, HealthService, type HealthOptions } from './health.service.ts';

export interface HealthRoutes {
  path?: string;
  readyPath?: string;
}

export class HealthModule {
  static forRoot(
    options: HealthOptions | (() => HealthOptions) = {},
    { path = '/health', readyPath = '/ready' }: HealthRoutes = {}
  ) {
    if (normalizePath(path) === normalizePath(readyPath)) {
      throw new Error(diagnostic('health.samePath', { path }));
    }

    const provider =
      typeof options === 'function'
        ? { provide: HEALTH_OPTIONS, useFactory: options }
        : { provide: HEALTH_OPTIONS, useValue: options };

    @Public()
    @Controller()
    class HealthController {
      private readonly health = inject(HealthService);

      @Get(path)
      live({ res }: HttpContext) {
        res.setHeader('Cache-Control', 'no-store');
        return { status: 'ok' };
      }

      @Get(readyPath)
      async ready({ res }: HttpContext) {
        res.setHeader('Cache-Control', 'no-store');
        if (await this.health.isReady()) return { status: 'ok' };

        res.status(503).json({ status: 'unavailable' });
        return undefined;
      }
    }

    @Module({
      providers: [provider, HealthService],
      exports: [HealthService],
      controllers: [HealthController],
    })
    class HealthRootModule {}

    return HealthRootModule;
  }
}
