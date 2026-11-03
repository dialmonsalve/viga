---
title: viga/health
description: Añade las rutas /health y /ready para que Kubernetes, Docker o un balanceador sepan si tu app está viva y lista para recibir tráfico.
head:
  - tag: title
    content: 'Health checks en Node.js con viga/health'
sidebar:
  order: 8
---

Kubernetes, Docker y los balanceadores preguntan a tu app periódicamente cómo está, para reiniciarla o dejar de enviarle tráfico si algo va mal. `viga/health` añade las dos rutas que necesitan:

| Ruta | Pregunta | Qué hace | Si falla |
| --- | --- | --- | --- |
| `GET /health` | ¿El proceso sigue vivo? | Responde 200, sin tocar ninguna dependencia. | Se reinicia la app. |
| `GET /ready` | ¿Puede atender peticiones? | Ejecuta tus comprobaciones y responde 200 o 503. | Se le deja de enviar tráfico, sin reiniciarla. |

`/health` no comprueba la base de datos a propósito: si la base de datos se cae, reiniciar la app no la arregla, y reiniciarlas todas a la vez solo empeora la situación.

## Añade las rutas

Importa `HealthModule` en el módulo raíz y declara qué tiene que funcionar para que la app esté lista:

```ts title="src/app.module.ts"
import { Module, inject } from 'viga';
import { CONFIG, ConfigModule } from 'viga/config';
import { DatabaseService, DrizzleModule } from 'viga/drizzle';
import { HealthModule } from 'viga/health';
import { Env } from './config.ts';

@Module({
  imports: [
    ConfigModule.forRoot({ schema: Env }),
    DrizzleModule.forRoot(() => ({ connection: inject(CONFIG).DATABASE_URL })),
    HealthModule.forRoot(() => {
      const database = inject(DatabaseService);

      return {
        checks: {
          database: () => database.ping(),
        },
      };
    }),
  ],
})
export class AppModule {}
```

Las dos rutas responden:

```json
{ "status": "ok" }
```

La función de `forRoot` se ejecuta dentro del contenedor al arrancar, así que puede pedir valores con `inject()`, pero solo ve los providers de los módulos globales. `DatabaseService` lo es, y para usar otro servicio, expórtalo desde un [módulo global](../../core/modules/#módulos-globales).

Si no necesitas `inject()`, pasa un objeto: `HealthModule.forRoot({ checks: { ... } })`. Sin comprobaciones, `HealthModule.forRoot()` hace que `/ready` responda siempre 200.

## Las comprobaciones

Una comprobación es una función que puede ser `async`. Falla si:

- lanza un error o su promesa se rechaza,
- devuelve `false`,
- no termina a tiempo.

Cualquier otro resultado se considera correcto. `DatabaseService.ping()` ejecuta `SELECT 1` y lanza un error si PostgreSQL no responde.

Comprueba solo lo que impide atender peticiones. Si tu app puede funcionar sin un servicio, por ejemplo mostrando datos antiguos cuando falla una caché, no lo incluyas: su caída dejaría a toda la app sin tráfico.

Evita también comprobar APIs de terceros. Si una cae, todas tus instancias dejan de estar listas a la vez, y tu app pasa a no responder a nada.

## Lo que ve quien llama

Estas rutas son públicas, también si la app tiene un [guard de autenticación](../../core/guards/#el-guard-de-autenticación), porque quien las llama no tiene sesión. Por eso no dan detalles. Si una comprobación falla, la respuesta es solo:

```json
{ "status": "unavailable" }
```

Qué comprobación falló, y por qué, va al [logger](../../core/providers/#usa-tu-propio-logger), que es donde lo buscarás:

```txt
[Health] The health check "database" failed
```

Así, la respuesta no revela qué infraestructura usas ni el contenido de los errores, que a menudo incluye direcciones internas. Si no quieres exponer las rutas en internet, no las publiques en tu proxy: las sondas de Kubernetes llaman directamente a la app.

## Opciones

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `checks` | `{}` | Las comprobaciones, con su nombre para el log. |
| `timeoutMs` | `3_000` | Lo que puede tardar cada comprobación. Si tarda más, falla. |
| `cacheMs` | `1_000` | Cuánto tiempo se reutiliza el último resultado. Con `0`, se comprueba en cada petición. |

Como `/ready` es pública, cualquiera podría llamarla en bucle para saturar tu base de datos. Por eso las peticiones simultáneas comparten una sola ejecución de las comprobaciones, y el resultado se reutiliza durante `cacheMs`. Con el valor por defecto, cada instancia las ejecuta como mucho una vez por segundo, reciba las peticiones que reciba.

Mantén `timeoutMs` por debajo del tiempo máximo que tu sonda espera una respuesta. Si no, la sonda abandona antes de que viga responda.

### Otras rutas

Las rutas se indican en el segundo argumento, porque viga tiene que conocerlas antes de crear los providers:

```ts
HealthModule.forRoot(options, { path: '/live', readyPath: '/status' });
```

Como las demás rutas, llevan el [`globalPrefix`](../../core/controllers/) de la app: con `globalPrefix: '/api'`, quedan en `/api/health` y `/api/ready`.

## Con Kubernetes

```yaml
spec:
  terminationGracePeriodSeconds: 40
  containers:
    - name: api
      startupProbe:
        httpGet: { path: /health, port: 3000 }
        periodSeconds: 2
        failureThreshold: 30
      livenessProbe:
        httpGet: { path: /health, port: 3000 }
        periodSeconds: 10
      readinessProbe:
        httpGet: { path: /ready, port: 3000 }
        periodSeconds: 5
        timeoutSeconds: 4
      lifecycle:
        preStop:
          exec:
            command: ['sleep', '5']
```

La app empieza a responder cuando termina de arrancar, después de los `onModuleInit`, así que `startupProbe` le da hasta un minuto para hacerlo sin que `livenessProbe` la reinicie.

### Al desplegar una versión nueva

`/ready` no avisa de que la app se está cerrando. Al recibir `SIGTERM`, [`close()`](../../core/app-lifecycle/#detenerse) deja de aceptar conexiones de inmediato, y Kubernetes puede tardar unos segundos en dejar de enviarle tráfico, así que algunas peticiones fallarían.

Por eso el ejemplo usa `preStop`: espera 5 segundos antes de enviar `SIGTERM`, para que Kubernetes retire la instancia mientras sigue atendiendo peticiones. Ajusta `terminationGracePeriodSeconds` para que incluya esa espera y lo que tarden en terminar las peticiones en curso. El comando necesita `sleep` en la imagen; las imágenes mínimas, como las *distroless*, no lo traen.

## Con Docker

Las imágenes de Node.js no siempre traen `curl`, pero sí Node.js:

```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
```

## Límites de peticiones

Las sondas son peticiones normales, así que cuentan para un [`rateLimit()`](../../security/rate-limiting/#para-toda-la-app) global, y un 429 en `/ready` se trata como un fallo. Con una sonda cada pocos segundos y un límite razonable no es un problema, pero tenlo en cuenta si el límite es muy bajo.

## En los tests

`/ready` se prueba como cualquier ruta con [`createTestingApp`](../testing/). Para simular un fallo, reemplaza `HEALTH_OPTIONS`:

```ts title="test/health.test.ts"
import { HEALTH_OPTIONS } from 'viga/health';
import { createTestingApp } from 'viga/testing';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: HEALTH_OPTIONS, useValue: { checks: { database: () => false } } }],
});

const response = await app.request('/ready');
assert.equal(response.status, 503);

await app.close();
```

Si necesitas el mismo resultado desde tu código, `HealthService` está disponible con `inject()` y su método `isReady()` devuelve `true` o `false`.
