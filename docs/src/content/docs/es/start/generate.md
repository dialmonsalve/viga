---
title: Generar código
description: Crea un recurso completo, un módulo, un controlador o un servicio con un comando, sin que viga toque tus archivos existentes.
sidebar:
  order: 5
---

`viga generate` crea los archivos de una funcionalidad nueva. Viene incluido en el paquete `viga`, así que no hay nada más que instalar. Ejecútalo desde la raíz de tu proyecto:

```sh
pnpm exec viga generate resource books
```

Con npm y yarn es `npx viga` y `yarn viga`, y `g` es un alias de `generate`.

| Tipo | Qué crea |
| --- | --- |
| `resource` | Un módulo, un controlador con rutas CRUD, un servicio y sus esquemas |
| `module` | Un módulo |
| `controller` | Un controlador |
| `service` | Un servicio |

## Un recurso

```txt
$ pnpm exec viga g resource books

created src/books/books.module.ts
created src/books/books.controller.ts
created src/books/books.service.ts
created src/books/books.schemas.ts

Add BooksModule to the imports of src/app.module.ts.
Its routes are private by default: add @Public() to open one, or set up app.useAuthGuard().
The service keeps its data in memory: replace it with your database when you are ready.
```

El resultado compila y funciona desde el primer momento, con estas rutas validadas:

| Ruta | Qué hace |
| --- | --- |
| `GET /books` | Lista todos |
| `GET /books/:id` | Devuelve uno, o 404 |
| `POST /books` | Crea uno |
| `PATCH /books/:id` | Modifica uno |
| `DELETE /books/:id` | Borra uno |

Es un punto de partida. Tres cosas quedan en tus manos:

- **Registra el módulo.** viga no edita tus archivos, así que añade `BooksModule` a los `imports` de `app.module.ts`.
- **Decide quién accede.** Las rutas son [privadas por defecto](../../core/guards/#rutas-privadas-por-defecto). Sin un guard de autenticación responden 401: añade `@Public()` o configura `app.useAuthGuard()`.
- **Cambia el almacenamiento.** El servicio guarda los datos en memoria, y se pierden al reiniciar. Sustitúyelo por tu base de datos.

## Validación

Los esquemas usan la librería que tengas en las `dependencies` de tu `package.json`, Zod o Valibot. Para indicarla, o si usas otra, añade `--schema zod` o `--schema valibot`. Con otra librería, tendrás que reescribir `books.schemas.ts`. `module`, `controller` y `service` no necesitan ninguna.

## Piezas sueltas

```sh
pnpm exec viga g module shop
pnpm exec viga g controller shop
pnpm exec viga g service shop
```

Los tres archivos van en `src/shop/`. Como el generador no edita nada, te indica dónde registrar cada pieza: añade el controlador a `controllers` y el servicio a `providers`.

## Nombres y carpetas

El nombre va en minúsculas, con guiones si tiene varias palabras: `order-items` crea `OrderItemsModule` y la ruta `/order-items`. Los esquemas usan una versión en singular, como `CreateOrderItem`. Esa conversión es sencilla y solo cubre los plurales regulares del inglés, así que revísala si el nombre es otro.

Para crear el recurso dentro de otra carpeta, inclúyela en el nombre. La carpeta no cambia la ruta de la API, que sigue siendo `/books`:

```sh
pnpm exec viga g resource admin/books
```

Eso crea `src/admin/books/`. Si tu código no está en `src`, indica la carpeta base con `--path`, siempre dentro de tu proyecto:

```sh
pnpm exec viga g service audit --path lib
```

Cada parte del nombre sigue el mismo formato, así que `..` no sirve para salir del proyecto.

## Tus archivos están a salvo

El generador nunca modifica un archivo existente. Si alguno de los que va a crear ya existe, no crea ninguno y te dice cuáles son.
