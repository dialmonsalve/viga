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
  'router.missingBodyValidation':
    '{controller}.{method} atiende {verb} pero no tiene @Validate({ body }), obligatorio con requireValidation',
  'interceptor.nextCalledTwice': 'next() solo puede llamarse una vez',
  'rateLimit.invalidOptions':
    'max y windowMs deben ser enteros positivos, se recibió max={max} windowMs={windowMs}',
  'rateLimit.invalidMaxKeys': 'maxKeys debe ser un entero positivo, se recibió {maxKeys}',
  'rateLimit.httpOnly':
    '@RateLimit de "viga" solo funciona en rutas HTTP; en un gateway usa RateLimit de "viga/websocket"',
  'lifecycle.destroyFailed': 'Falló el cierre de uno o más providers',
  'lifecycle.serverCloseFailed': 'Uno o más providers fallaron mientras se cerraba el servidor',
  'app.getBeforeInit': 'get() solo puede llamarse después de init() o listen()',
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
  'drizzle.idleClientError': 'Error inesperado en una conexión inactiva de PostgreSQL',
  'drizzle.nestedTransactionConfig':
    'Una transacción anidada no puede cambiar la configuración de la transacción exterior',
  'ws.invalidEvent':
    'Nombre de evento inválido "{event}": usa de 1 a 128 letras, números, ".", ":", "_" o "-"',
  'ws.duplicatePath': 'Los gateways {first} y {second} usan la misma ruta {path}',
  'ws.duplicateEvent': '{gateway} maneja el evento "{event}" más de una vez',
  'ws.missingValidation':
    '{gateway}.{method} maneja "{event}" sin schema, obligatorio por requireValidation',
  'ws.unhandledException': 'Excepción no controlada en un gateway de WebSocket',
  'ws.invalidOption': '{option} debe ser un entero positivo, se recibió {value}',
  'ws.handshakeTimeout':
    'authenticate no respondió en {ms} ms, así que el handshake se rechazó con 503',
  'ws.missingPackage':
    'El adaptador de WebSocket por defecto necesita el paquete "ws": instálalo, o pasa tu propio adaptador en WebSocketModule.forRoot({ adapter })',
} as const satisfies Record<DiagnosticKey, string>;
