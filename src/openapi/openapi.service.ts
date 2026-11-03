import { Injectable } from '../decorators/injectable.ts';
import { InjectionToken, inject } from '../di/injector.ts';
import type { OnServerListen } from '../di/lifecycle.ts';
import { MOUNTED_ROUTES } from '../http/router.ts';
import { LOGGER } from '../logger.ts';
import { buildDocument, type OpenApiDocument, type OpenApiOptions } from './document.ts';

export const OPENAPI_OPTIONS = new InjectionToken<OpenApiOptions>('OPENAPI_OPTIONS');

@Injectable()
export class OpenApiService implements OnServerListen {
  private readonly options = inject(OPENAPI_OPTIONS);
  private readonly mounted = inject(MOUNTED_ROUTES);
  private readonly logger = inject(LOGGER);
  private built?: OpenApiDocument;

  document(): OpenApiDocument {
    this.built ??= buildDocument(this.options, this.mounted(), (message) => this.logger.warn(message));
    return this.built;
  }

  onServerListen() {
    this.document();
  }
}
