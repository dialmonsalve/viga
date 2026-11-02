---
title: '@vigajs/core/workers'
description: Ejecuta trabajo en segundo plano con el mismo código dentro de la API, en procesos hijos o en otro servidor, con un supervisor que reinicia los procesos caídos.
sidebar:
  order: 11
---

Un worker es la parte de tu app que hace trabajo en segundo plano, fuera de las peticiones: importar un CSV, enviar emails o generar informes. `@vigajs/core/workers` te deja escribirlo una vez y decidir después dónde se ejecuta. También trae un supervisor que crea un proceso por cada clave, por ejemplo uno por empresa, y lo reinicia si se cae.

**No es un sistema de colas.** viga no guarda trabajos, no los reintenta ni los programa: para eso usa una librería como BullMQ o pg-boss. Lo que hace `@vigajs/core/workers` es arrancar, detener y vigilar el proceso donde corre esa librería.

## Escribe el worker

Un worker es un provider normal: empieza a consumir trabajos en `onModuleInit` y deja de hacerlo en `onModuleDestroy`. `WORKER_KEY` le dice qué clave atiende:

```ts title="src/imports/imports.worker.ts"
import { Injectable, inject, runInNewContext, type OnModuleDestroy, type OnModuleInit } from '@vigajs/core';
import { WORKER_KEY } from '@vigajs/core/workers';
import { Worker, type Job } from 'bullmq';

@Injectable()
export class ImportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly key = inject(WORKER_KEY);
  private readonly imports = inject(ImportsService);
  private queue?: Worker;

  onModuleInit() {
    this.queue = new Worker(`imports-${this.key}`, (job) => this.process(job), { connection });
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  private async process(job: Job) {
    return runInNewContext(() => this.imports.run(job.data));
  }
}
```

`runInNewContext` le da a cada trabajo su propio [contexto](../../core/request-lifecycle/#fuera-de-una-petición), como si fuera una petición, para que un trabajo no vea los valores de otro.

Agrúpalo en su módulo, sin controladores ni nada que dependa de HTTP:

```ts title="src/imports/imports-worker.module.ts"
import { Module } from '@vigajs/core';

@Module({
  imports: [ImportsModule],
  providers: [ImportsWorker],
})
export class ImportsWorkerModule {}
```

## Elige dónde se ejecuta

| Modo | Aislamiento | Cuándo usarlo |
| --- | --- | --- |
| [Dentro de la API](#dentro-de-la-api) | Ninguno: comparte proceso con tus rutas. | Trabajo ligero de entrada y salida, y desarrollo. |
| [Procesos hijos](#procesos-hijos) | Un fallo o un uso alto de CPU no detiene la API. | Una sola máquina, o un proceso por empresa. |
| [Otro servidor](#otro-servidor) | También aísla la memoria y la máquina. | Cuando tienes que escalar los workers aparte de la API. |

El trabajo que usa mucha CPU, como procesar un CSV de 100 000 filas, necesita al menos un proceso aparte. Node.js ejecuta tu código en un solo hilo: dentro de la API, todas las peticiones esperarían a que termine.

### Dentro de la API

Importa el módulo en la API, con la clave que atiende:

```ts title="src/app.module.ts"
import { WorkerModule } from '@vigajs/core/workers';

@Module({
  imports: [WorkerModule.forKey('emails'), ImportsWorkerModule],
})
export class AppModule {}
```

### Procesos hijos

Crea un archivo de entrada para el worker:

```ts title="src/worker.ts"
import { startWorker } from '@vigajs/core/workers';
import { ImportsWorkerModule } from './imports/imports-worker.module.ts';

await startWorker(ImportsWorkerModule);
```

Y añade el supervisor a la API:

```ts title="src/app.module.ts"
import { WorkersModule } from '@vigajs/core/workers';

WorkersModule.forRoot({
  entry: new URL('./worker.ts', import.meta.url),
  keys: ['imports', 'reports'],
}),
```

Escribe la ruta con `.ts`: si al compilar solo existe `worker.js`, viga usa ese.

`ImportsWorkerModule` es la raíz del proceso hijo, así que importa en él los [módulos globales](../../core/modules/#módulos-globales) que necesite, como `ConfigModule`. El proceso hijo arranca su propia app, con sus propios providers y conexiones: no comparte memoria con la API.

### Otro servidor

El mismo archivo de entrada se ejecuta por su cuenta, con la clave como argumento:

```sh
node dist/worker.js emails
```

Es lo adecuado con Docker, systemd o Kubernetes, que ya reinician los procesos caídos, y `startWorker` responde a `SIGTERM` con un cierre ordenado:

```dockerfile
CMD ["node", "dist/worker.js", "emails"]
```

Si en ese servidor necesitas un proceso por empresa, usa `WorkersModule` en una app que llame a `init()` en lugar de `listen()`.

## Un worker por empresa

Si cada empresa tiene su propia cola, la lista de claves sale de tu base de datos. Pasa una función a `forRoot`, que puede pedir providers de los módulos globales con `inject()`:

```ts title="src/app.module.ts"
WorkersModule.forRoot(() => {
  const tenants = inject(TenantsService);

  return {
    entry: new URL('./worker.ts', import.meta.url),
    keys: () => tenants.slugs(),
    maxWorkers: 20,
  };
}),
```

Con `WorkerSupervisor` gestionas los workers con la app en marcha, por ejemplo al registrar una empresa:

```ts
import { WorkerSupervisor } from '@vigajs/core/workers';

private readonly workers = inject(WorkerSupervisor);

async createTenant(data: NewTenant) {
  const tenant = await this.tenants.create(data);
  await this.workers.start(tenant.slug);
  return tenant;
}
```

| Método | Qué hace |
| --- | --- |
| `start(key)` | Arranca un worker. Si ya existe, no hace nada. |
| `stop(key)` | Lo detiene y espera a que termine. Si no existe, no hace nada. |
| `list()` | Devuelve `key`, `status` (`running`, `restarting` o `stopping`), `pid` y `restarts` de cada uno. |

La clave llega al worker como argumento y solo acepta letras, números, `.`, `_`, `:` y `-`, así que un slug válido sirve tal cual. Dentro del worker, usa `WORKER_KEY` para elegir la cola y guardar la empresa en el contexto de cada trabajo:

```ts
private async process(job: Job) {
  return runInNewContext(async () => {
    CURRENT_TENANT.set(await this.tenants.findBySlug(this.key));
    return this.imports.run(job.data);
  });
}
```

### Cuánta memoria consume

Cada worker es un proceso de Node.js con su propia copia de tu app. Un proceso viga inactivo, sin más dependencias que el propio viga, usa unos 80 MiB de memoria residente, y tus dependencias y tus datos se suman a eso. Parte de esa memoria se comparte entre procesos, así que el coste real es algo menor, pero mídelo en tu app antes de decidir.

Por eso `maxWorkers` vale 8 por defecto, y superarlo da un error en lugar de agotar la memoria de la máquina. Súbelo cuando sepas que tu máquina los soporta. Si son muchas empresas y la mayoría están inactivas casi siempre, una sola cola compartida con la empresa en cada trabajo gasta mucho menos.

El aislamiento de CPU tiene otro límite: solo se mantiene mientras haya menos workers activos que núcleos.

## Cuando un worker falla

El supervisor reinicia un worker que termina con error, y registra cada caída:

```txt
[Workers] The worker imports exited with code 1; restarting it in 1000 ms
```

La espera empieza en 1 segundo y se duplica en cada caída hasta 30 segundos, para que un worker que falla al arrancar no consuma la máquina. Si estuvo funcionando al menos 60 segundos, vuelve a empezar desde 1 segundo. Un worker que termina con código 0 se considera terminado a propósito, y no se reinicia.

Un reinicio no recupera el trabajo que estaba en curso. Eso depende de tu librería de colas, que normalmente lo vuelve a entregar, así que un trabajo tiene que poder repetirse sin efectos duplicados.

## Al detenerse

Cuando la app se detiene, el supervisor envía `SIGTERM` a cada worker, que cierra ordenadamente ejecutando sus `onModuleDestroy`. Esto ocurre después de que terminen las peticiones en curso.

Si un worker no termina en 30 segundos, el supervisor lo cierra a la fuerza con `SIGKILL` y lo registra. Cámbialo con `stopTimeoutMs`, según lo que tarde tu trabajo más largo, y mantenlo por debajo del tiempo que tu plataforma da para terminar. Si no, la plataforma detendrá el proceso antes.

Si el proceso padre muere de golpe, sin ocasión de avisar, sus workers lo detectan y se cierran solos, así que no quedan procesos huérfanos. Si ese cierre se cuelga, el worker termina a la fuerza tras 30 segundos, o lo que indiques en `startWorker(Module, { orphanTimeoutMs })`.

## Variables de entorno y argumentos

Un worker hereda las variables de entorno del proceso que lo crea, y también sus argumentos de Node.js. Por eso funciona igual con `node --import tsx` o con `tsx` que con el código compilado. Las excepciones son `--inspect` y `--watch`: todos los procesos competirían por el mismo puerto, y `--watch` reiniciaría cada uno por su cuenta.

Las dos cosas se pueden cambiar:

```ts
WorkersModule.forRoot({
  entry: new URL('./worker.ts', import.meta.url),
  env: { ...process.env, LOG_LEVEL: 'warn' },
  execArgv: ['--max-old-space-size=512'],
}),
```

Si usas `process.loadEnvFile()` en `main.ts`, los hijos reciben esas variables. Un worker que se ejecuta [por su cuenta](#otro-servidor) tiene que cargarlas él mismo.

## En los tests

Prueba la lógica del worker sin procesos, entregando la clave con `WorkerModule.forKey`:

```ts title="test/imports.test.ts"
import { createTestingApp } from '@vigajs/core/testing';
import { WorkerModule } from '@vigajs/core/workers';

@Module({ imports: [WorkerModule.forKey('test'), ImportsWorkerModule] })
class TestModule {}

const app = await createTestingApp(TestModule, {
  overrides: [{ provide: ImportsService, useValue: fakeImports }],
});
```
