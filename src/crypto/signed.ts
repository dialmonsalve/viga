import { Injectable } from '../decorators/injectable.ts';
import { UseGuards, type CanActivate, type GuardDecorator } from '../decorators/use-guards.ts';
import { inject } from '../di/injector.ts';
import type { HttpContext } from '../http/context.ts';
import { UrlSigner } from './url-signer.ts';

@Injectable()
class SignedGuard implements CanActivate {
  private readonly signer = inject(UrlSigner);

  canActivate({ req }: HttpContext) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    return this.signer.verify(req.originalUrl, { method });
  }
}

export function Signed(): GuardDecorator {
  return UseGuards(SignedGuard);
}
