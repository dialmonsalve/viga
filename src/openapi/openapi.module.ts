import { Controller, Get } from '../decorators/controller.ts';
import { Module } from '../decorators/module.ts';
import { Public } from '../decorators/public.ts';
import { inject } from '../di/injector.ts';
import { Docs } from './docs.ts';
import type { OpenApiOptions } from './document.ts';
import { OPENAPI_OPTIONS, OpenApiService } from './openapi.service.ts';

export interface OpenApiRoutes {
  path?: string;
  public?: boolean;
}

function noDecorator() {
  return undefined;
}

export class OpenApiModule {
  static forRoot(
    options: OpenApiOptions | (() => OpenApiOptions),
    { path = '/openapi.json', public: isPublic = false }: OpenApiRoutes = {}
  ) {
    const provider =
      typeof options === 'function'
        ? { provide: OPENAPI_OPTIONS, useFactory: options }
        : { provide: OPENAPI_OPTIONS, useValue: options };

    @(isPublic ? Public() : noDecorator)
    @Controller()
    class OpenApiController {
      private readonly openApi = inject(OpenApiService);

      @Get(path)
      @Docs({ hidden: true })
      document() {
        return this.openApi.document();
      }
    }

    @Module({
      providers: [provider, OpenApiService],
      exports: [OpenApiService],
      controllers: [OpenApiController],
    })
    class OpenApiRootModule {}

    return OpenApiRootModule;
  }
}
