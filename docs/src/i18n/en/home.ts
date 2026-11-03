export default {
  title: 'viga: HTTP framework for Node.js and TypeScript',
  description:
    'HTTP framework for Node.js and TypeScript on top of Express 5, with modules, dependency injection, standard decorators and private routes by default.',
  brand: 'viga',
  nav: {
    label: 'Main',
    docs: 'Documentation',
    docsShort: 'Docs',
    modules: 'Modules',
    guides: 'Guides',
  },
  languages: 'Language',
  theme: {
    toDark: 'Switch to dark mode',
    toLight: 'Switch to light mode',
  },
  mascotAlt: 'Beaver, the viga mascot, holding a steel beam',
  heading: 'HTTP framework for Node.js and TypeScript',
  tagline:
    'Organize your API in modules, with dependency injection and standard JavaScript decorators. Every route is private until you decide to open it.',
  cta: 'Get started',
  secondaryCta: 'What is viga',
  copy: {
    idle: 'Copy',
    done: 'Copied',
    failed: "Couldn't copy",
  },
  install: {
    label: 'Create a project',
    projectName: 'my-app',
    requirements: 'Requires Node.js 24.13 or later.',
  },
  example: {
    title: 'An API in a few lines',
    label: 'Example files',
    heading: 'What this code does',
    intro: "The example's controller has a public route and a private one that validates what it receives:",
    points: [
      {
        title: 'Private unless you say otherwise',
        text: "`@Public()` opens `GET /books`. `POST /books` doesn't have it, so it responds 401 until the app has an authentication guard that lets the request through.",
      },
      {
        title: 'Validated, typed data',
        text: '`@Validate` checks the body before calling the method, and its type comes from the same schema. It works with Zod, Valibot, ArkType or any library compatible with Standard Schema.',
      },
      {
        title: 'Dependencies without metadata',
        text: '`inject()` asks for the service and viga creates it once. You need neither `reflect-metadata` nor `experimentalDecorators`.',
      },
    ],
  },
  features: {
    heading: "How it's built",
    items: [
      {
        title: 'Standard decorators',
        text: 'It uses the JavaScript decorators that TypeScript supports without experimental options.',
        href: 'start/what-is-viga/',
      },
      {
        title: 'Modules and dependency injection',
        text: 'Each feature lives in its own module, and providers are only shared if you export them.',
        href: 'core/modules/',
      },
      {
        title: 'Restrictive values from the start',
        text: "Private routes, security headers and a body size limit come turned on and can be adjusted. They don't replace reviewing your own app.",
        href: 'security/defaults/',
      },
      {
        title: 'On top of Express 5',
        text: 'You keep using the Express middlewares you already know, with `app.use()`.',
        href: 'core/request-lifecycle/#express-middlewares',
      },
      {
        title: 'Promises, no RxJS',
        text: 'Handlers, guards and interceptors work with `async/await`.',
        href: 'core/interceptors/',
      },
      {
        title: 'Code generator',
        text: "`viga generate resource books` creates the module, the controller and the service, without changing the files you already have.",
        href: 'start/generate/',
      },
    ],
  },
  modules: {
    heading: 'Optional modules',
    intro:
      "They come in the same package and only load if you import them. Some also need their own library, like Drizzle ORM, ws or Multer.",
    items: [
      { name: 'viga/config', text: 'Validated, typed environment variables.', href: 'optional/config/' },
      { name: 'viga/validation', text: 'Validate body, params and query.', href: 'optional/validation/' },
      { name: 'viga/testing', text: 'Tests with real HTTP requests.', href: 'optional/testing/' },
      { name: 'viga/pagination', text: 'Paginated lists with limits.', href: 'optional/pagination/' },
      { name: 'viga/i18n', text: "Responses in each user's language.", href: 'optional/i18n/' },
      { name: 'viga/drizzle', text: 'PostgreSQL with Drizzle ORM and transactions.', href: 'optional/drizzle/' },
      { name: 'viga/websocket', text: 'Real time on the same port, with rooms.', href: 'optional/websocket/' },
      { name: 'viga/health', text: '/health and /ready routes for Kubernetes or Docker.', href: 'optional/health/' },
      { name: 'viga/crypto', text: 'Passwords, tokens, signed URLs and encryption.', href: 'optional/crypto/' },
      { name: 'viga/events', text: 'Typed, in-memory event bus.', href: 'optional/events/' },
      { name: 'viga/workers', text: 'Background work in other processes.', href: 'optional/workers/' },
      { name: 'viga/upload', text: 'File uploads with limits.', href: 'optional/upload/' },
    ],
  },
  guides: {
    heading: 'Guides',
    intro: 'Common problems solved from start to finish:',
    items: [
      { title: 'JWT authentication and refresh tokens', href: 'guides/jwt-auth/' },
      { title: 'Multi-tenant with subdomains', href: 'guides/multi-tenant/' },
      { title: 'Queues and workers with BullMQ and pg-boss', href: 'guides/queues-workers/' },
      { title: 'Sending email', href: 'guides/email/' },
      { title: 'Block VPNs', href: 'guides/vpn-blocking/' },
      { title: 'License activation', href: 'guides/license-activation/' },
    ],
  },
  closing: {
    heading: 'Create your first API',
    text: 'A step-by-step guide to putting together an API with a module, a controller and a service.',
    cta: 'Build your first app',
  },
  footer: {
    license: 'MIT License',
  },
};
