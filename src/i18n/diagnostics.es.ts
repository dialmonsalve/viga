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
} as const satisfies Record<DiagnosticKey, string>;
