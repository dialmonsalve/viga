import type { Application, Request } from 'express';
import type { IncomingMessage } from 'node:http';
import { InjectionToken } from '../di/injector.ts';

export type ClientIpResolver = (req: IncomingMessage) => string | undefined;

export const CLIENT_IP = new InjectionToken<ClientIpResolver>('CLIENT_IP');

export function clientIpResolver(app: Application): ClientIpResolver {
  const { request } = app as Application & { request: Request };
  return (req) => {
    const view: Request = Object.create(request, {
      headers: { value: req.headers },
      socket: { value: req.socket },
    });
    return view.ip;
  };
}
