import type { DiagnosticKey } from '../diagnostics.ts';

export const diagnosticsEs = {
  'di.injectOutsideContainer':
    'inject({token}) solo puede llamarse mientras el contenedor construye una clase',
  'di.notCreatedByContainer': '{name} no fue creada por el contenedor',
  'di.notInjectable': '{name} debe estar decorada con @Injectable()',
  'di.cannotResolve':
    '{injector} no puede resolver {token}: falta en providers o en los exports de un módulo importado',
  'di.circularDependency': 'Dependencia circular en {injector}: {chain}',
  'module.circularImport': 'Importación circular: {chain}',
  'module.notModule': '{name} debe estar decorada con @Module()',
  'module.globalOutsideRoot':
    '{name} es global y se importa desde {importer}, pero no desde el módulo raíz; muévelo a los imports de {root}',
  'router.notController': '{name} debe estar decorada con @Controller()',
  'router.notMethod': '{controller}.{method} no es un método',
  'interceptor.nextCalledTwice': 'next() solo puede llamarse una vez',
  'rateLimit.invalidOptions':
    'max y windowMs deben ser enteros positivos, se recibió max={max} windowMs={windowMs}',
  'rateLimit.invalidMaxKeys': 'maxKeys debe ser un entero positivo, se recibió {maxKeys}',
  'rateLimit.invalidIpv6Subnet': 'ipv6Subnet debe ser un entero entre 1 y 128, se recibió {ipv6Subnet}',
  'rateLimit.httpOnly':
    '@RateLimit de "viga" solo funciona en rutas HTTP; en un gateway usa RateLimit de "viga/websocket"',
  'testing.unknownOverride':
    'El override de {token} no coincide con ningún provider; revisa que el token sea el mismo que declara el módulo',
  'lifecycle.destroyFailed': 'Falló el cierre de uno o más providers',
  'lifecycle.serverCloseFailed': 'Uno o más providers fallaron mientras se cerraba el servidor',
  'app.noAuthGuard':
    'No hay un guard de autenticación configurado, así que las {count} rutas privadas responderán 401; añade app.useAuthGuard() o marca las rutas públicas con @Public()',
  'app.publicRoutes': 'Rutas públicas: {routes}',
  'app.invalidTrustedOrigin':
    'csrf.trustedOrigins debe contener orígenes como https://app.example (esquema, host y puerto opcional, sin ruta ni barra final), se recibió {origin}',
  'app.getBeforeInit': 'get() solo puede llamarse después de init() o listen()',
  'app.trustProxyAll':
    'trustProxy: true toma la IP del cliente del primer valor de X-Forwarded-For, que el cliente puede falsificar para saltarse los límites; usa el número de proxies delante de la app (por ejemplo 1) o sus direcciones',
  'app.alreadyListening': 'El servidor ya está escuchando',
  'app.configureAfterStart': '{method}() debe llamarse antes de init() o listen()',
  'app.listening': 'Servidor escuchando en el puerto {port}{prefix}',
  'app.signalReceived': 'Señal {signal} recibida, cerrando',
  'app.closeFailed': 'Error al cerrar',
  'http.unhandledException': 'Excepción no controlada',
  'context.missingValue': 'No hay un valor para "{key}" en el contexto actual',
  'context.setOutsideScope':
    'set("{key}") solo puede llamarse dentro de una petición o de runInNewContext()',
  'i18n.unknownDefaultLocale':
    'El idioma por defecto "{locale}" no está entre los catálogos: {locales}',
  'drizzle.insecureConnection':
    'PostgreSQL se conecta a {host} sin TLS, así que credenciales y datos viajan en claro; configura ssl en la conexión o añade sslmode=verify-full a la URL',
  'drizzle.unverifiedTls':
    'PostgreSQL usa TLS con rejectUnauthorized: false, así que no verifica el certificado del servidor y un intermediario puede leer la conexión; pasa la CA en ssl.ca',
  'drizzle.idleClientError': 'Error inesperado en una conexión inactiva de PostgreSQL',
  'drizzle.nestedTransactionConfig':
    'Una transacción anidada no puede cambiar la configuración de la transacción exterior',
  'config.invalid': 'Configuración inválida:\n{issues}',
  'config.asyncSchema': 'El schema de configuración tiene que validar de forma síncrona',
  'pagination.invalidOptions':
    'defaultLimit, maxLimit, maxPage y maxOffset deben ser enteros positivos y defaultLimit no puede superar a maxLimit, se recibió defaultLimit={defaultLimit} maxLimit={maxLimit} maxPage={maxPage} maxOffset={maxOffset}',
  'health.invalidOptions':
    'timeoutMs debe ser un entero positivo y cacheMs un entero no negativo, se recibió timeoutMs={timeoutMs} cacheMs={cacheMs}',
  'health.samePath': 'Las rutas de liveness y readiness no pueden compartir la ruta {path}',
  'health.checkFailed': 'La comprobación de salud "{name}" falló',
  'health.checkTimedOut': 'No terminó en {timeoutMs} ms',
  'health.checkReturnedFalse': 'Devolvió false',
  'crypto.invalidTokenSize': 'Un token necesita al menos {min} bytes aleatorios, se recibió {bytes}',
  'crypto.shortKey': '{name} debe tener al menos {min} bytes; genérala con randomBytes(32).toString("base64url")',
  'crypto.noSigningKeys': 'Las URLs firmadas necesitan signingKeys en CryptoModule.forRoot()',
  'crypto.noEncryptionKeys': 'El cifrado necesita la opción encryption en CryptoModule.forRoot()',
  'crypto.invalidExpiry': 'expiresInSeconds debe ser un entero positivo, se recibió {expiresInSeconds}',
  'crypto.invalidSignedPath': 'Solo se pueden firmar rutas como /files/42, se recibió {path}',
  'crypto.reservedSignedParam': 'La ruta {path} ya tiene un parámetro expires o signature',
  'crypto.invalidKeyId': 'El id de clave de cifrado "{id}" solo puede contener letras, números, "_" y "-"',
  'crypto.unknownActiveKey': 'La clave de cifrado activa "{active}" no está entre las claves',
  'crypto.decryptFailed': 'No se pudo descifrar el valor',
  'ws.noAuthenticate':
    'No hay una función authenticate configurada, así que los {count} gateways privados rechazarán cada handshake con 401; define authenticate en WebSocketModule.forRoot() o marca los gateways públicos con @Public()',
  'ws.publicGateways': 'Gateways públicos: {paths}',
  'ws.invalidEvent':
    'Nombre de evento inválido "{event}": usa de 1 a 128 letras, números, ".", ":", "_" o "-"',
  'ws.duplicatePath': 'Los gateways {first} y {second} usan la misma ruta {path}',
  'ws.duplicateEvent': '{gateway} maneja el evento "{event}" más de una vez',
  'ws.unhandledException': 'Excepción no controlada en un gateway de WebSocket',
  'ws.invalidOption': '{option} debe ser un entero positivo, se recibió {value}',
  'ws.untrustedForwardedFor':
    'Un handshake WebSocket trae X-Forwarded-For pero trustProxy no confía en quien lo envía, así que connectionsPerKey cuenta como uno a todos los clientes detrás de ese proxy; pon en trustProxy el número de proxies delante de la app',
  'ws.invalidExpiresAt':
    'expiresAt debe ser un Date o una marca de tiempo en milisegundos, se recibió {value}',
  'ws.handshakeTimeout':
    'authenticate no respondió en {ms} ms, así que el handshake se rechazó con 503',
  'ws.missingPackage':
    'El adaptador de WebSocket por defecto necesita el paquete "ws": instálalo, o pasa tu propio adaptador en WebSocketModule.forRoot({ adapter })',
} as const satisfies Record<DiagnosticKey, string>;
