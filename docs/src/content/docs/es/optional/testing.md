---
title: viga/testing
description: Prueba tu app con peticiones HTTP reales, reemplazando los providers que no quieres usar en las pruebas, como la base de datos o un servicio externo.
sidebar:
  order: 7
---

`viga/testing` arranca tu app en un puerto libre y te permite hacerle peticiones HTTP reales. Las peticiones pasan por todo el recorrido: guards, validación, interceptores, controladores y servicios, igual que en producción. Lo que no quieres usar en una prueba, como la base de datos o un servicio de pagos, lo reemplazas por una versión falsa.

No trae su propio ejecutor de pruebas. Los ejemplos usan `node:test`, el que viene con Node.js, que no necesita instalar nada.

## Tu primera prueba

```ts title="src/books/books.test.ts"
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createTestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';

it('lista los libros', async () => {
  const app = await createTestingApp(AppModule);

  try {
    const { status, body } = await app.request('/books');
    assert.equal(status, 200);
    assert.deepEqual(body, [{ id: 1, title: 'Dune' }, { id: 2, title: 'Fundación' }]);
  } finally {
    await app.close();
  }
});
```

`createTestingApp` recibe el módulo raíz y devuelve la app ya escuchando en un puerto libre de `127.0.0.1`. `app.request()` le hace una petición y devuelve el código de estado, las cabeceras y el cuerpo, ya convertido si la respuesta es JSON.

`app.close()` detiene el servidor y cierra los providers. Ponlo en un `finally` para que se ejecute aunque la prueba falle; si no, el proceso de pruebas puede quedarse esperando.

## Ejecuta las pruebas

Node.js no entiende los decoradores todavía, así que las pruebas se ejecutan con `tsx`, el mismo que usas en desarrollo. Añade un script a tu `package.json`:

```json title="package.json"
{
  "scripts": {
    "test": "node --import tsx --test \"src/**/*.test.ts\""
  }
}
```

Y ejecútalo con `pnpm test`, `npm test`, `yarn test` o `bun run test`, según tu gestor de paquetes.

## Una app para varias pruebas

Arrancar la app en cada prueba es lo más aislado, pero también lo más lento. Si las pruebas de un archivo no se afectan entre sí, comparte una sola app con `before` y `after`:

```ts title="src/books/books.test.ts"
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestingApp, type TestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';

describe('libros', () => {
  let app: TestingApp;

  before(async () => {
    app = await createTestingApp(AppModule);
  });

  after(() => app.close());

  it('lista los libros', async () => {
    const { status } = await app.request('/books');
    assert.equal(status, 200);
  });

  it('responde 404 si el libro no existe', async () => {
    const { status } = await app.request('/books/99');
    assert.equal(status, 404);
  });
});
```

## Haz peticiones

`app.request()` acepta el método, un cuerpo JSON y cabeceras:

```ts
const { status, body, headers } = await app.request('/books', {
  method: 'POST',
  json: { title: 'Dune', year: 1965 },
  headers: { authorization: 'Bearer token-de-prueba' },
});

assert.equal(status, 201);
assert.equal(headers.get('x-request-id')?.length, 36);
```

Con `json`, viga añade la cabecera `content-type: application/json` por ti. Para enviar otro tipo de cuerpo, usa `body` con un texto o bytes, y pon tú la cabecera.

Para tipar el cuerpo de la respuesta, pásale el tipo: `app.request<Book[]>('/books')`.

## Reemplaza providers

La opción `overrides` reemplaza providers sin tocar el código de la app. Usa la misma forma que los providers de un módulo, normalmente con `useValue`:

```ts
const app = await createTestingApp(AppModule, {
  overrides: [
    { provide: BOOKS_REPOSITORY, useValue: { findAll: async () => [{ id: 9, title: 'Libro de prueba' }] } },
  ],
});
```

El controlador y el servicio son los reales; solo cambia el repositorio. Lo viste en [repositorios](../../start/repositories/#reemplázalo-en-las-pruebas).

Algunas cosas que conviene saber:

- **El provider original nunca se crea.** Si reemplazas `DatabaseService`, la app no abre ninguna conexión a la base de datos, ni siquiera al arrancar.
- **Funciona en cualquier módulo**, incluidos los importados y los globales, sin cambiar qué módulos pueden verlo.
- **Un override que no coincide con ningún provider da error**, para que un token mal escrito no pase desapercibido:

```txt
[Testing] The override for InjectionToken(BOOKS_REPOSITORY) does not match any provider; check that the token is the same one the module declares
```

### Cambia la configuración

Para usar otra configuración en las pruebas sin tocar `process.env`, reemplaza `CONFIG`:

```ts
import { CONFIG } from 'viga/config';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: CONFIG, useValue: { PORT: 0, DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 'x'.repeat(32) } }],
});
```

Este valor no se valida con el esquema de [`viga/config`](../config/): escribe un objeto completo y correcto.

## La autenticación en las pruebas

`createTestingApp` mantiene los valores por defecto de producción: las rutas privadas responden 401 hasta que configures un guard de autenticación, y `requireValidation` y la protección CSRF siguen activas. Así las pruebas detectan los mismos errores que verías en producción.

Para probar rutas privadas, usa `configure`, que recibe la app antes de arrancar. Con un guard falso que siempre deja pasar y guarda un usuario de prueba, tus servicios funcionan como con un usuario real:

```ts
import { CURRENT_USER } from '../auth/current-user.ts';

const app = await createTestingApp(AppModule, {
  configure: (app) =>
    app.useAuthGuard(() => {
      CURRENT_USER.set({ id: 1, role: 'admin' });
      return true;
    }),
});
```

Para probar que una ruta rechaza a quien no está autenticado, crea otra app sin `configure` y comprueba que responde 401.

`createTestingApp` acepta las mismas opciones que `createApp`, como `globalPrefix`. Por defecto usa un logger silencioso para no llenar la salida de las pruebas; pasa `logger` si quieres ver los logs.

## Otras herramientas

- `app.get(token)` devuelve un provider que el módulo raíz puede ver, por ejemplo para preparar datos antes de una petición o comprobar el estado después.
- `app.url(path)` devuelve la URL completa, como `http://127.0.0.1:41235/books`, para usarla con otro cliente HTTP. Para un WebSocket, cambia `http://` por `ws://`.
- `app.app` es la app de viga que hay detrás, por si necesitas algo que `createTestingApp` no expone.
