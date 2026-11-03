export default {
  title: 'viga: framework HTTP para Node.js y TypeScript',
  description:
    'Framework HTTP para Node.js y TypeScript sobre Express 5, con módulos, inyección de dependencias, decoradores estándar y rutas privadas por defecto.',
  brand: 'viga',
  nav: {
    label: 'Principal',
    docs: 'Documentación',
    docsShort: 'Docs',
    modules: 'Módulos',
    guides: 'Guías',
  },
  languages: 'Idioma',
  theme: {
    toDark: 'Cambiar a modo oscuro',
    toLight: 'Cambiar a modo claro',
  },
  mascotAlt: 'Castor, la mascota de viga, sosteniendo una viga de acero',
  heading: 'Framework HTTP para Node.js y TypeScript',
  tagline:
    'Organiza tu API en módulos, con inyección de dependencias y decoradores estándar de JavaScript. Todas las rutas son privadas hasta que decides abrirlas.',
  cta: 'Empezar',
  secondaryCta: 'Qué es viga',
  copy: {
    idle: 'Copiar',
    done: 'Copiado',
    failed: 'No se pudo copiar',
  },
  install: {
    label: 'Crea un proyecto',
    projectName: 'mi-app',
    requirements: 'Requiere Node.js 24.13 o superior.',
  },
  example: {
    title: 'Una API en pocas líneas',
    label: 'Archivos del ejemplo',
    heading: 'Lo que hace este código',
    intro: 'El controlador del ejemplo tiene una ruta pública y otra privada que valida lo que recibe:',
    points: [
      {
        title: 'Privada, salvo que digas lo contrario',
        text: '`@Public()` abre `GET /books`. `POST /books` no lo lleva, así que responde 401 hasta que la app tenga un guard de autenticación que deje pasar la petición.',
      },
      {
        title: 'Datos validados y tipados',
        text: '`@Validate` comprueba el body antes de llamar al método, y su tipo sale del mismo esquema. Funciona con Zod, Valibot, ArkType o cualquier librería compatible con Standard Schema.',
      },
      {
        title: 'Dependencias sin metadatos',
        text: '`inject()` pide el servicio y viga lo crea una vez. No hace falta `reflect-metadata` ni `experimentalDecorators`.',
      },
    ],
  },
  features: {
    heading: 'Cómo está hecho',
    items: [
      {
        title: 'Decoradores estándar',
        text: 'Usa los decoradores de JavaScript que TypeScript soporta sin opciones experimentales.',
        href: 'start/what-is-viga/',
      },
      {
        title: 'Módulos e inyección de dependencias',
        text: 'Cada funcionalidad vive en su módulo, y los providers se comparten solo si los exportas.',
        href: 'core/modules/',
      },
      {
        title: 'Valores restrictivos desde el inicio',
        text: 'Rutas privadas, cabeceras de seguridad y límite de tamaño del body vienen activados y se pueden ajustar. No sustituyen a revisar tu propia app.',
        href: 'security/defaults/',
      },
      {
        title: 'Sobre Express 5',
        text: 'Sigues usando los middlewares de Express que ya conoces, con `app.use()`.',
        href: 'core/request-lifecycle/#middlewares-de-express',
      },
      {
        title: 'Promesas, sin RxJS',
        text: 'Handlers, guards e interceptores trabajan con `async/await`.',
        href: 'core/interceptors/',
      },
      {
        title: 'Generador de código',
        text: '`viga generate resource books` crea el módulo, el controlador y el servicio, sin modificar los archivos que ya tienes.',
        href: 'start/generate/',
      },
    ],
  },
  modules: {
    heading: 'Módulos opcionales',
    intro:
      'Vienen en el mismo paquete y solo se cargan si los importas. Algunos necesitan además su librería, como Drizzle ORM, ws o Multer.',
    items: [
      { name: 'viga/config', text: 'Variables de entorno validadas y tipadas.', href: 'optional/config/' },
      { name: 'viga/validation', text: 'Valida body, params y query.', href: 'optional/validation/' },
      { name: 'viga/testing', text: 'Pruebas con peticiones HTTP reales.', href: 'optional/testing/' },
      { name: 'viga/pagination', text: 'Listados paginados con límites.', href: 'optional/pagination/' },
      { name: 'viga/i18n', text: 'Respuestas en el idioma de cada usuario.', href: 'optional/i18n/' },
      { name: 'viga/drizzle', text: 'PostgreSQL con Drizzle ORM y transacciones.', href: 'optional/drizzle/' },
      { name: 'viga/websocket', text: 'Tiempo real en el mismo puerto, con salas.', href: 'optional/websocket/' },
      { name: 'viga/health', text: 'Rutas /health y /ready para Kubernetes o Docker.', href: 'optional/health/' },
      { name: 'viga/crypto', text: 'Contraseñas, tokens, URLs firmadas y cifrado.', href: 'optional/crypto/' },
      { name: 'viga/events', text: 'Bus de eventos en memoria y tipado.', href: 'optional/events/' },
      { name: 'viga/workers', text: 'Trabajo en segundo plano en otros procesos.', href: 'optional/workers/' },
      { name: 'viga/upload', text: 'Subida de archivos con límites.', href: 'optional/upload/' },
      { name: 'viga/openapi', text: 'Documento OpenAPI 3.1 a partir de tus decoradores.', href: 'optional/openapi/' },
    ],
  },
  guides: {
    heading: 'Guías',
    intro: 'Problemas habituales resueltos de principio a fin:',
    items: [
      { title: 'Tutorial: API REST con PostgreSQL', href: 'guides/rest-api/' },
      { title: 'Autenticación con JWT y refresh tokens', href: 'guides/jwt-auth/' },
      { title: 'Multi-tenant con subdominios', href: 'guides/multi-tenant/' },
      { title: 'Colas y workers con BullMQ y pg-boss', href: 'guides/queues-workers/' },
      { title: 'Envío de correos', href: 'guides/email/' },
      { title: 'Bloquear VPN', href: 'guides/vpn-blocking/' },
      { title: 'Activación de licencias', href: 'guides/license-activation/' },
      { title: 'Documentación de tu API con Scalar', href: 'guides/scalar/' },
    ],
  },
  closing: {
    heading: 'Crea tu primera API',
    text: 'Una guía paso a paso para montar una API con un módulo, un controlador y un servicio.',
    cta: 'Construye tu primera app',
  },
  footer: {
    license: 'Licencia MIT',
  },
};
