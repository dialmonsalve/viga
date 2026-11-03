export default {
  title: 'viga: framework HTTP para Node.js e TypeScript',
  description:
    'Framework HTTP para Node.js e TypeScript sobre o Express 5, com módulos, injeção de dependências, decoradores padrão e rotas privadas por padrão.',
  brand: 'viga',
  nav: {
    label: 'Principal',
    docs: 'Documentação',
    docsShort: 'Docs',
    modules: 'Módulos',
    guides: 'Guias',
  },
  languages: 'Idioma',
  theme: {
    toDark: 'Mudar para o modo escuro',
    toLight: 'Mudar para o modo claro',
  },
  mascotAlt: 'Castor, o mascote do viga, segurando uma viga de aço',
  heading: 'Framework HTTP para Node.js e TypeScript',
  tagline:
    'Organize sua API em módulos, com injeção de dependências e decoradores padrão do JavaScript. Todas as rotas são privadas até você decidir abri-las.',
  cta: 'Começar',
  secondaryCta: 'O que é o viga',
  copy: {
    idle: 'Copiar',
    done: 'Copiado',
    failed: 'Não foi possível copiar',
  },
  install: {
    label: 'Crie um projeto',
    projectName: 'meu-app',
    requirements: 'Requer Node.js 24.13 ou superior.',
  },
  example: {
    title: 'Uma API em poucas linhas',
    label: 'Arquivos do exemplo',
    heading: 'O que este código faz',
    intro: 'O controlador do exemplo tem uma rota pública e outra privada que valida o que recebe:',
    points: [
      {
        title: 'Privada, a menos que você diga o contrário',
        text: '`@Public()` abre `GET /books`. `POST /books` não o tem, então responde 401 até que a aplicação tenha um guard de autenticação que deixe a requisição passar.',
      },
      {
        title: 'Dados validados e tipados',
        text: '`@Validate` verifica o body antes de chamar o método, e o tipo dele vem do mesmo esquema. Funciona com Zod, Valibot, ArkType ou qualquer biblioteca compatível com Standard Schema.',
      },
      {
        title: 'Dependências sem metadados',
        text: '`inject()` pede o serviço e o viga o cria uma vez. Não é preciso `reflect-metadata` nem `experimentalDecorators`.',
      },
    ],
  },
  features: {
    heading: 'Como é feito',
    items: [
      {
        title: 'Decoradores padrão',
        text: 'Usa os decoradores do JavaScript que o TypeScript suporta sem opções experimentais.',
        href: 'start/what-is-viga/',
      },
      {
        title: 'Módulos e injeção de dependências',
        text: 'Cada funcionalidade fica em seu módulo, e os providers só são compartilhados se você os exportar.',
        href: 'core/modules/',
      },
      {
        title: 'Valores restritivos desde o início',
        text: 'Rotas privadas, cabeçalhos de segurança e limite de tamanho do body vêm ativados e podem ser ajustados. Não substituem a revisão da sua aplicação.',
        href: 'security/defaults/',
      },
      {
        title: 'Sobre o Express 5',
        text: 'Você continua usando os middlewares do Express que já conhece, com `app.use()`.',
        href: 'core/request-lifecycle/#middlewares-do-express',
      },
      {
        title: 'Promises, sem RxJS',
        text: 'Handlers, guards e interceptors trabalham com `async/await`.',
        href: 'core/interceptors/',
      },
      {
        title: 'Gerador de código',
        text: '`viga generate resource books` cria o módulo, o controlador e o serviço, sem modificar os arquivos que você já tem.',
        href: 'start/generate/',
      },
    ],
  },
  modules: {
    heading: 'Módulos opcionais',
    intro:
      'Vêm no mesmo pacote e só são carregados se você os importar. Alguns também precisam da própria biblioteca, como Drizzle ORM, ws ou Multer.',
    items: [
      { name: 'viga/config', text: 'Variáveis de ambiente validadas e tipadas.', href: 'optional/config/' },
      { name: 'viga/validation', text: 'Valide body, params e query.', href: 'optional/validation/' },
      { name: 'viga/testing', text: 'Testes com requisições HTTP reais.', href: 'optional/testing/' },
      { name: 'viga/pagination', text: 'Listagens paginadas com limites.', href: 'optional/pagination/' },
      { name: 'viga/i18n', text: 'Respostas no idioma de cada usuário.', href: 'optional/i18n/' },
      { name: 'viga/drizzle', text: 'PostgreSQL com Drizzle ORM e transações.', href: 'optional/drizzle/' },
      { name: 'viga/websocket', text: 'Tempo real na mesma porta, com salas.', href: 'optional/websocket/' },
      { name: 'viga/health', text: 'Rotas /health e /ready para Kubernetes ou Docker.', href: 'optional/health/' },
      { name: 'viga/crypto', text: 'Senhas, tokens, URLs assinadas e criptografia.', href: 'optional/crypto/' },
      { name: 'viga/events', text: 'Barramento de eventos em memória e tipado.', href: 'optional/events/' },
      { name: 'viga/workers', text: 'Trabalho em segundo plano em outros processos.', href: 'optional/workers/' },
      { name: 'viga/upload', text: 'Upload de arquivos com limites.', href: 'optional/upload/' },
    ],
  },
  guides: {
    heading: 'Guias',
    intro: 'Problemas comuns resolvidos do início ao fim:',
    items: [
      { title: 'Autenticação com JWT e refresh tokens', href: 'guides/jwt-auth/' },
      { title: 'Multi-tenant com subdomínios', href: 'guides/multi-tenant/' },
      { title: 'Filas e workers com BullMQ e pg-boss', href: 'guides/queues-workers/' },
      { title: 'Envio de emails', href: 'guides/email/' },
      { title: 'Bloquear VPNs', href: 'guides/vpn-blocking/' },
      { title: 'Ativação de licenças', href: 'guides/license-activation/' },
    ],
  },
  closing: {
    heading: 'Crie sua primeira API',
    text: 'Um guia passo a passo para montar uma API com um módulo, um controlador e um serviço.',
    cta: 'Construa sua primeira aplicação',
  },
  footer: {
    license: 'Licença MIT',
  },
};
