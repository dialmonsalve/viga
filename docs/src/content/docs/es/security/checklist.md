---
title: Lista para pruebas de seguridad
description: Lo que depende de tu código y conviene revisar antes de una auditoría o una prueba de penetración, con ejemplos de cómo resolverlo en viga.
sidebar:
  order: 4
---

viga cubre algunas capas habituales con sus [valores por defecto](../defaults/), pero muchas otras dependen de tu código. Esta lista reúne lo primero que revisa una prueba de seguridad de caja gris, es decir, con usuarios y roles reales de tu app.

No es una lista completa: es un punto de partida. Repásala antes de cada salida a producción y antes de una auditoría.

## Autorización por recurso

Exigir una sesión no basta: hay que comprobar que el recurso pertenece a quien lo pide. Si `GET /orders/42` devuelve el pedido 42 a cualquier usuario autenticado, un usuario puede ver los pedidos de otros cambiando el número. Este fallo se llama IDOR (*insecure direct object reference*) y es de los más frecuentes.

Filtra por el usuario actual en el repositorio, no después:

```ts title="src/orders/orders.repository.ts"
findOwned(id: number) {
  const { id: ownerId } = CURRENT_USER.get();
  return this.database.db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.ownerId, ownerId)),
  });
}
```

Si no lo encuentra, responde 404 y no 403. Con un 403 confirmarías que el pedido 42 existe y es de otro.

## Varias empresas en la misma app

En una app multi-tenant, el mismo fallo aparece entre empresas: un usuario de la empresa A no debe ver datos de la empresa B. El identificador de la empresa que envía el cliente, por ejemplo en una cabecera, nunca es de fiar por sí solo. Compruébalo en un guard contra los tenants del usuario autenticado, guárdalo en una [clave de contexto](../../core/request-lifecycle/#el-contexto-de-la-petición) y filtra todas las consultas por él.

## Asignación masiva

Si guardas el cuerpo de la petición tal cual, un cliente puede añadir campos que no esperabas, como `"role": "admin"` o `"ownerId": 7`. Valida todo cuerpo con [`@Validate`](../../optional/validation/#los-campos-que-sobran-se-descartan) y usa el valor validado: los campos que no están en el esquema se descartan. Si prefieres rechazarlos, usa un objeto estricto de tu librería de esquemas, como `z.strictObject()` en Zod o `v.strictObject()` en Valibot.

`requireValidation` ya rechaza el cuerpo en las rutas que no lo validan, pero no puede saber si tu esquema incluye un campo que no debería.

## Roles y permisos

Pon el guard de roles sobre el controlador con [`@UseGuards()`](../../core/guards/#guards-por-ruta), no en cada método. Así una ruta nueva no queda abierta por olvido. Revisa también la lista de rutas públicas que viga muestra al arrancar con nivel `debug`: es todo lo que cualquiera puede llamar sin autenticarse.

## Fuerza bruta

Limita el inicio de sesión, el registro, la recuperación de contraseña y la verificación de códigos con [`@RateLimit()`](../rate-limiting/#por-ruta). Para el inicio de sesión, una clave por IP y email frena a quien prueba muchas contraseñas para una misma cuenta.

Asegúrate de que [`trustProxy`](../client-ip/) coincide con los proxies que tienes delante. Si no, el límite se aplica a la IP del proxy, o un atacante puede cambiar de IP en cada petición.

## Mensajes de error

No distingas "el usuario no existe" de "la contraseña es incorrecta": responde siempre con `UnauthorizedException()`. Si los distingues, un atacante puede averiguar qué emails están registrados. Lo mismo vale para la recuperación de contraseña: responde igual exista o no la cuenta.

Los errores inesperados ya responden con un mensaje genérico, pero revisa que tus propias excepciones no incluyan detalles internos, como nombres de tablas o el mensaje original de la base de datos.

## CORS

Configura CORS con una lista explícita de orígenes. Nunca combines `origin: '*'` con `credentials: true`: permitiría que cualquier sitio hiciera peticiones con las cookies de tus usuarios.

## CSRF

Si autenticas con cookies, deja activada la [protección CSRF](../defaults/#protección-csrf) y nunca cambies datos en una ruta `GET`: no se comprueba, porque un enlace o una imagen pueden provocarla.

## WebSocket

Si usas [`@vigajs/core/websocket`](../../optional/websocket/), revisa tres cosas:

- **`allowedOrigins`** contiene solo tus sitios, para que otra página no pueda abrir un WebSocket con las cookies de tus usuarios.
- **Las sesiones caducan**: devuelve `expiresAt` en `authenticate` para que una conexión abierta no siga funcionando con una sesión que ya expiró.
- **Cada evento que recibe datos tiene un esquema** en `@OnMessage`.

## Secretos y configuración

- Valida las variables de entorno con [`@vigajs/core/config`](../../optional/config/), para que una configuración incompleta impida arrancar en lugar de fallar más tarde.
- No subas el archivo `.env` al repositorio.
- En producción, conéctate a la base de datos con TLS verificado. [`@vigajs/core/drizzle`](../../optional/drizzle/#tls) avisa al arrancar si no es así.

## Dependencias

Revisa las vulnerabilidades conocidas de tus dependencias con regularidad, por ejemplo con el comando `audit` de tu gestor de paquetes (`pnpm audit`, `npm audit`...) o la herramienta de tu proveedor de repositorios, y mantenlas actualizadas.
