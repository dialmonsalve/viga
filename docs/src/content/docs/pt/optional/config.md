---
title: viga/config
description: Valide e tipe as variáveis de ambiente ao iniciar, para que uma configuração incorreta impeça a aplicação de iniciar em vez de falhar em produção.
sidebar:
  order: 2
---

`viga/config` lê as variáveis de ambiente, as valida com um schema ao iniciar a aplicação e as entrega já convertidas e com seu tipo. Se faltar uma variável ou seu valor não for válido, a aplicação não inicia e o erro diz quais falham.

Sem isso, uma variável escrita errado aparece como `undefined` no meio de uma requisição, às vezes dias depois do deploy. Com `viga/config`, o problema aparece ao iniciar a aplicação, antes de atender alguém.

Funciona com qualquer biblioteca compatível com Standard Schema, a mesma que você usa com [`viga/validation`](../validation/). Os exemplos usam Zod.

## Defina o schema

Descreva as variáveis de que sua aplicação precisa:

```ts title="src/config.ts"
import { z } from 'zod';

export const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
});

declare module 'viga/config' {
  interface Register {
    schema: typeof Env;
  }
}
```

As variáveis de ambiente são sempre texto, então use `z.coerce` para as que devem ser números ou booleanos. Aqui `PORT` passa de `'3000'` para `3000`, e se não estiver definida vale `3000` por causa do `default`.

O bloco `declare module` registra seu schema em `viga/config`. Graças a ele, o TypeScript sabe o tipo de cada variável quando você a pede. Você só precisa escrevê-lo uma vez em todo o projeto.

## Registre o módulo

Importe `ConfigModule.forRoot` no módulo raiz. É um módulo global, então a configuração fica disponível em todos os módulos:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { ConfigModule } from 'viga/config';
import { BooksModule } from './books/books.module.ts';
import { Env } from './config.ts';

@Module({ imports: [ConfigModule.forRoot({ schema: Env }), BooksModule] })
export class AppModule {}
```

## Use a configuração

Peça `CONFIG` com `inject()` a partir de qualquer provider:

```ts title="src/database/database.service.ts"
import { Injectable, inject, type OnModuleDestroy } from 'viga';
import { CONFIG } from 'viga/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly config = inject(CONFIG);
  readonly pool = new Pool({ connectionString: this.config.DATABASE_URL });

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`this.config.DATABASE_URL` é uma `string` e `this.config.PORT` é um `number`, sem conversões nem verificações de `undefined`. Se você escrever errado o nome de uma variável, o TypeScript aponta.

### Em `main.ts`

O viga não lê a variável `PORT` por conta própria. Para passá-la a `listen()`, inicie a aplicação com `init()` e leia a configuração com `app.get()`:

```ts title="src/main.ts"
import { createApp } from 'viga';
import { CONFIG } from 'viga/config';
import { AppModule } from './app.module.ts';

const app = await createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks().init();

await app.listen(app.get(CONFIG).PORT);
```

`app.get()` só funciona depois de `init()`, porque antes disso a configuração ainda não foi validada.

## Quando a configuração não é válida

Se alguma variável falhar, a aplicação não inicia e o erro lista todas de uma vez:

```txt
[Config] Invalid configuration:
  - DATABASE_URL: Invalid URL
  - JWT_SECRET: Too small: expected string to have >=32 characters
```

Assim você pode corrigir todas de uma vez, em vez de descobri-las uma por uma.

### Os valores nunca aparecem no erro

As variáveis de ambiente costumam conter segredos, e os erros acabam em logs que mais gente lê. Por isso o viga nunca mostra o valor de uma variável no erro. Se uma mensagem o incluir, por exemplo uma que você escreveu, o viga o substitui por `***`:

```txt
  - JWT_SECRET: JWT_SECRET is too short: ***
```

## A configuração não pode ser modificada

O viga congela o resultado, incluindo objetos e arrays aninhados. Nenhum código pode mudar a configuração enquanto a aplicação está em execução: tentar lança um `TypeError`.

Além disso, a configuração só contém as variáveis que você declarou. O resto de `process.env`, como `PATH` ou as variáveis de outros serviços, não está em `CONFIG`.

## Arquivos `.env`

O viga não lê arquivos `.env` por conta própria: carregar o arquivo é uma decisão que fica visível no seu projeto. O Node.js já sabe fazer isso, e você tem duas formas de pedir. Escolha a que preferir; o resultado é o mesmo.

### A partir do código

`process.loadEnvFile()` carrega o arquivo `.env` da pasta a partir da qual você inicia a aplicação. Chame-o no início de `main.ts`:

```ts title="src/main.ts" ins={1,6}
import { existsSync } from 'node:fs';
import { createApp } from 'viga';
import { CONFIG } from 'viga/config';
import { AppModule } from './app.module.ts';

if (existsSync('.env')) process.loadEnvFile();

const app = await createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks().init();

await app.listen(app.get(CONFIG).PORT);
```

Você não precisa mexer no `package.json`, e funciona igual com `tsx` e com `node`. A verificação com `existsSync` evita que a aplicação falhe onde não há arquivo, como em produção.

Funciona mesmo que `AppModule` seja importado antes da chamada, porque `viga/config` lê as variáveis ao iniciar a aplicação, não ao importar o módulo.

### A partir dos scripts

A opção `--env-file-if-exists` do Node.js faz o mesmo pela linha de comando, e o `tsx` também a aceita:

```json title="package.json"
{
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/main.ts",
    "start": "node --env-file-if-exists=.env dist/main.js"
  }
}
```

Se o arquivo não existir, o Node.js mostra um aviso e continua sem ele. Se preferir que a aplicação não inicie quando o arquivo faltar, use `--env-file` no lugar.

### As variáveis do ambiente têm prioridade

Nas duas formas, o arquivo nunca substitui uma variável que já existe no ambiente. Em produção, o habitual é que as variáveis venham do Docker, do Kubernetes ou da sua plataforma de deploy: essas sempre ganham, mesmo que haja um `.env` no servidor.

:::caution
Não envie o arquivo `.env` para o repositório: adicione-o ao `.gitignore`. Se quiser documentar quais variáveis são necessárias, envie um `.env.example` com as mesmas chaves e valores de exemplo.
:::

## Outra fonte de variáveis

Por padrão, `ConfigModule` lê `process.env`. A opção `env` aceita qualquer objeto, por exemplo um construído em um teste:

```ts
ConfigModule.forRoot({
  schema: Env,
  env: { DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 'x'.repeat(32) },
});
```

### Segredos de um serviço externo

Se alguns segredos vêm de um serviço como Vault ou AWS Secrets Manager, carregue-os antes e passe-os com `env`, junto com as variáveis do ambiente:

```ts title="src/config.ts"
const secrets = await loadSecretsFromVault();

export const env = { ...process.env, ...secrets };
```

```ts title="src/app.module.ts"
@Module({ imports: [ConfigModule.forRoot({ schema: Env, env }), BooksModule] })
export class AppModule {}
```

`loadSecretsFromVault` representa a função que o seu serviço de segredos usa. O `await` de nível superior funciona porque o projeto usa módulos ES: quando `AppModule` é avaliado, os segredos já estão carregados. Depois, `viga/config` os valida como qualquer outra variável.

## O schema precisa ser síncrono

O viga valida a configuração de forma síncrona, porque os providers a usam enquanto são construídos: o `Pool` do exemplo anterior precisa de `DATABASE_URL` nesse mesmo momento. Se o schema tiver validações assíncronas, como um `refine` que consulta um serviço, a aplicação não inicia e o erro explica o motivo.

O que costuma motivar uma validação assíncrona tem seu próprio lugar:

- **Carregar segredos** de um serviço externo: antes de iniciar, como no exemplo anterior.
- **Verificar se um serviço responde**, como o banco de dados: no `onModuleInit` do seu provider, como explicado no [ciclo de vida da aplicação](../../core/app-lifecycle/#os-hooks-dos-providers).
