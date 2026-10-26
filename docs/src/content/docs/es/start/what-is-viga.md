---
title: Qué es viga
description: Framework HTTP para Node.js con módulos, inyección de dependencias y decoradores estándar.
sidebar:
  order: 1
---

viga es un framework HTTP para Node.js construido sobre Express 5. Organiza una API en módulos, resuelve sus dependencias con inyección de dependencias y usa los decoradores estándar de JavaScript para declarar controladores, rutas, guards e interceptores.

## El problema que resuelve

Express es pequeño y flexible, pero deja casi todo en tus manos. En cada proyecto nuevo hay que decidir cómo organizar el código, cómo compartir servicios entre partes de la app, cómo validar lo que llega, cómo responder los errores y qué cabeceras y límites configurar. Cada equipo lo resuelve a su manera, y esas decisiones se repiten de proyecto en proyecto.

viga parte de una estructura ya decidida. Defines módulos, controladores y servicios, y el framework los conecta. Además, la app arranca cerrada: toda ruta es privada hasta que la marcas como pública con `@Public()`, y si no configuras cómo autenticar, las rutas privadas responden 401 en lugar de quedar abiertas por olvido.

## Para quién es

viga es para quienes construyen APIs HTTP con Node.js y TypeScript y quieren:

- Una estructura clara desde el primer día, sin tener que inventarla.
- Partir de una app cerrada y abrir solo lo que decidan, en lugar de cerrar después lo que quedó expuesto.
- Flexibilidad para elegir sus herramientas: la librería de validación, el ORM o la forma de autenticar.
- Seguir usando el ecosistema de Express, con sus middlewares de siempre.

Si vienes de NestJS, la forma de organizar el código te resultará familiar.

## Ideas principales

### Decoradores estándar de JavaScript

viga usa los decoradores estándar de JavaScript, la propuesta del comité TC39 que TypeScript soporta sin opciones experimentales. No necesita `reflect-metadata`, `experimentalDecorators` ni `emitDecoratorMetadata`. Las dependencias se piden de forma explícita con `inject()`:

```ts
@Injectable()
class BooksService {
  private readonly database = inject(DatabaseService);
}
```

### Un núcleo pequeño y módulos opcionales

El núcleo trae solo lo que toda API necesita: módulos, inyección de dependencias, controladores, guards, interceptores, excepciones HTTP y ciclo de vida. Lo demás vive en subrutas opcionales, como `viga/validation`, `viga/config`, `viga/i18n`, `viga/pagination`, `viga/drizzle`, `viga/websocket` y `viga/testing`. Si no las importas, no se instala nada extra.

### Cerrado por defecto

Además de las rutas privadas, viga trae activados valores que reducen riesgos comunes:

- Cabeceras de seguridad, límite de tamaño del body y tiempos máximos para recibir cada petición.
- Una ruta sin esquema de body no acepta body, así que un dato sin validar no llega a tu código.
- Rechazo de los formularios enviados desde otros sitios, que es la vía habitual de un ataque CSRF.
- Cuando hay un guard de autenticación, las rutas inexistentes responden igual que las privadas a quien no tiene sesión, para que no se pueda descubrir qué rutas existen.

Cada uno se puede ajustar o desactivar de forma explícita. Estos valores no hacen segura una aplicación por sí solos: la seguridad también depende de tu código, tu configuración y tu infraestructura.

### Elige tus herramientas

viga no te ata a una librería concreta. La validación funciona con cualquier librería compatible con [Standard Schema](https://standardschema.dev), como Zod, Valibot o ArkType. La base de datos puede usar el módulo de Drizzle o cualquier otro ORM a través de un provider. Y para autenticar, configuras tu propio guard con la librería que prefieras.

### Promesas, sin RxJS

Los handlers, guards e interceptores trabajan con promesas y `async/await`. No hay observables que aprender.

## Inspirado en NestJS

viga está inspirado en [NestJS](https://nestjs.com). Los módulos, la inyección de dependencias, los controladores con decoradores, los guards y los interceptores vienen de las ideas que Kamil Myśliwiec y la comunidad de Nest llevan años perfeccionando.

viga no comparte código con Nest. Toma esas ideas y las lleva a otro terreno: decoradores estándar en lugar de `experimentalDecorators` y `reflect-metadata`, promesas en lugar de RxJS y un núcleo pequeño con todo lo demás opcional.

De [Express](https://expressjs.com) toma la base: viga se ejecuta sobre Express 5, así que sus middlewares, como `cors`, funcionan con `app.use()`, y cada handler tiene a mano la petición y la respuesta de Express cuando las necesita.

## Lo que viga no hace

viga se limita a lo que casi toda API HTTP necesita. Lo que se puede resolver bien desde fuera no forma parte del framework, para que siga siendo pequeño y fácil de entender. Por eso no incluye:

- Un sistema de autenticación propio, como JWT, OAuth o sesiones. viga te da el lugar donde conectarlo, `app.useAuthGuard()`, y tú eliges la librería.
- Caché, colas ni tareas programadas.
- Envío de correo ni almacenamiento de archivos.
- GraphQL ni microservicios.

Para varias de estas necesidades, la documentación incluirá guías que muestran cómo integrarlas con librerías conocidas.
