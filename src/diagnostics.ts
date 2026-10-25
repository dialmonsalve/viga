import { interpolate, type MessageParams } from './http/messages.ts';

export const DIAGNOSTICS = {
  'di.injectOutsideContainer':
    'inject({token}) can only be called while the container is constructing a class',
  'di.notCreatedByContainer': '{name} was not created by the container',
  'di.notInjectable': '{name} must be decorated with @Injectable()',
  'di.cannotResolve':
    '{injector} cannot resolve {token}: it is missing from providers or from the exports of an imported module',
  'di.circularDependency': 'Circular dependency in {injector}: {chain}',
  'module.circularImport': 'Circular import: {chain}',
  'module.notModule': '{name} must be decorated with @Module()',
  'module.globalOutsideRoot':
    '{name} is global and is imported from {importer}, but not from the root module; move it to the imports of {root}',
  'router.notController': '{name} must be decorated with @Controller()',
  'router.notMethod': '{controller}.{method} is not a method',
  'interceptor.nextCalledTwice': 'next() can only be called once',
  'rateLimit.invalidOptions':
    'max and windowMs must be positive integers, received max={max} windowMs={windowMs}',
  'rateLimit.invalidMaxKeys': 'maxKeys must be a positive integer, received {maxKeys}',
  'rateLimit.invalidIpv6Subnet': 'ipv6Subnet must be an integer between 1 and 128, received {ipv6Subnet}',
  'rateLimit.httpOnly':
    '@RateLimit from "viga" only works on HTTP routes; in a gateway use RateLimit from "viga/websocket"',
  'lifecycle.destroyFailed': 'One or more providers failed to shut down',
  'lifecycle.serverCloseFailed': 'One or more providers failed while the server was closing',
  'app.noAuthGuard':
    'No auth guard is configured, so the {count} private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()',
  'app.publicRoutes': 'Public routes: {routes}',
  'app.invalidTrustedOrigin':
    'csrf.trustedOrigins must contain origins like https://app.example (scheme, host and optional port, no path or trailing slash), received {origin}',
  'app.getBeforeInit': 'get() can only be called after init() or listen()',
  'app.trustProxyAll':
    'trustProxy: true takes the client IP from the first X-Forwarded-For value, which the client can forge to bypass rate limits; use the number of proxies in front of the app (for example 1) or their addresses',
  'app.alreadyListening': 'The server is already listening',
  'app.configureAfterStart': '{method}() must be called before init() or listen()',
  'app.listening': 'Server listening on port {port}{prefix}',
  'app.signalReceived': '{signal} received, shutting down',
  'app.closeFailed': 'Error while shutting down',
  'http.unhandledException': 'Unhandled exception',
  'context.missingValue': 'There is no value for "{key}" in the current context',
  'context.setOutsideScope':
    'set("{key}") can only be called inside a request or inside runInNewContext()',
  'i18n.unknownDefaultLocale':
    'The default locale "{locale}" is not among the catalogs: {locales}',
  'drizzle.insecureConnection':
    'PostgreSQL connects to {host} without TLS, so credentials and data travel in clear text; set ssl in the connection or add sslmode=verify-full to the URL',
  'drizzle.unverifiedTls':
    'PostgreSQL uses TLS with rejectUnauthorized: false, so it does not verify the server certificate and a man in the middle can read the connection; pass the CA in ssl.ca instead',
  'drizzle.idleClientError': 'Unexpected error on an idle PostgreSQL connection',
  'drizzle.nestedTransactionConfig':
    'A nested transaction cannot change the configuration of the outer transaction',
  'config.invalid': 'Invalid configuration:\n{issues}',
  'config.asyncSchema': 'The configuration schema must validate synchronously',
  'pagination.invalidOptions':
    'defaultLimit, maxLimit, maxPage and maxOffset must be positive integers and defaultLimit cannot exceed maxLimit, received defaultLimit={defaultLimit} maxLimit={maxLimit} maxPage={maxPage} maxOffset={maxOffset}',
  'ws.noAuthenticate':
    'No authenticate function is configured, so the {count} private gateways will reject every handshake with 401; set authenticate in WebSocketModule.forRoot() or mark public gateways with @Public()',
  'ws.publicGateways': 'Public gateways: {paths}',
  'ws.invalidEvent':
    'Invalid event name "{event}": use 1 to 128 letters, digits, ".", ":", "_" or "-"',
  'ws.duplicatePath': 'The gateways {first} and {second} use the same path {path}',
  'ws.duplicateEvent': '{gateway} handles the event "{event}" more than once',
  'ws.missingValidation':
    '{gateway}.{method} handles "{event}" without a schema, required by requireValidation',
  'ws.unhandledException': 'Unhandled exception in a WebSocket gateway',
  'ws.invalidOption': '{option} must be a positive integer, received {value}',
  'ws.untrustedForwardedFor':
    'A WebSocket handshake carries X-Forwarded-For but trustProxy does not trust its sender, so connectionsPerKey counts every client behind that proxy as one; set trustProxy to the number of proxies in front of the app',
  'ws.invalidExpiresAt':
    'expiresAt must be a Date or a timestamp in milliseconds, received {value}',
  'ws.handshakeTimeout':
    'authenticate did not respond within {ms} ms, so the handshake was rejected with 503',
  'ws.missingPackage':
    'The default WebSocket adapter needs the "ws" package: install it, or pass your own adapter in WebSocketModule.forRoot({ adapter })',
} as const;

export type DiagnosticKey = keyof typeof DIAGNOSTICS;
export type DiagnosticDictionary = Partial<Record<DiagnosticKey, string>>;

const PREFIXES: Record<string, string> = {
  di: 'DI',
  module: 'Module',
  router: 'Router',
  interceptor: 'Interceptor',
  rateLimit: 'RateLimit',
  lifecycle: 'Lifecycle',
  app: 'App',
  http: 'HTTP',
  context: 'Context',
  i18n: 'I18n',
  drizzle: 'Drizzle',
  config: 'Config',
  pagination: 'Pagination',
  ws: 'WebSocket',
};

let overrides: DiagnosticDictionary = {};

export function setDiagnostics(dictionary: DiagnosticDictionary) {
  overrides = { ...dictionary };
}

export function diagnostic(key: DiagnosticKey, params?: MessageParams): string {
  const [namespace = ''] = key.split('.');
  const template = overrides[key] ?? DIAGNOSTICS[key];
  return `[${PREFIXES[namespace] ?? namespace}] ${interpolate(template, params)}`;
}
