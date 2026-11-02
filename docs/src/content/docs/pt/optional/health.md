---
title: '@vigajs/core/health'
description: Adicione as rotas /health e /ready para que o Kubernetes, o Docker ou um balanceador saibam se a sua aplicação está viva e pronta para receber tráfego.
sidebar:
  order: 8
---

O Kubernetes, o Docker e os balanceadores perguntam periodicamente à sua aplicação como ela está, para reiniciá-la ou parar de enviar tráfego se algo der errado. O `@vigajs/core/health` adiciona as duas rotas de que eles precisam:

| Rota | Pergunta | O que faz | Se falhar |
| --- | --- | --- | --- |
| `GET /health` | O processo continua vivo? | Responde 200, sem tocar em nenhuma dependência. | A aplicação é reiniciada. |
| `GET /ready` | Ela pode atender requisições? | Executa as suas verificações e responde 200 ou 503. | Ela deixa de receber tráfego, sem ser reiniciada. |

`/health` não verifica o banco de dados de propósito: se o banco cair, reiniciar a aplicação não resolve, e reiniciar todas as instâncias ao mesmo tempo só piora a situação.

## Adicione as rotas

Importe `HealthModule` no módulo raiz e declare o que precisa funcionar para que a aplicação esteja pronta:

```ts title="src/app.module.ts"
import { Module, inject } from '@vigajs/core';
import { CONFIG, ConfigModule } from '@vigajs/core/config';
import { DatabaseService, DrizzleModule } from '@vigajs/core/drizzle';
import { HealthModule } from '@vigajs/core/health';
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

As duas rotas respondem:

```json
{ "status": "ok" }
```

A função de `forRoot` é executada dentro do contêiner ao iniciar, então pode pedir valores com `inject()`, mas só vê os providers dos módulos globais. `DatabaseService` é um deles, e para usar outro serviço, exporte-o de um [módulo global](../../core/modules/#módulos-globais).

Se você não precisa de `inject()`, passe um objeto: `HealthModule.forRoot({ checks: { ... } })`. Sem verificações, `HealthModule.forRoot()` faz `/ready` responder sempre 200.

## As verificações

Uma verificação é uma função que pode ser `async`. Ela falha se:

- lançar um erro ou sua promise for rejeitada,
- devolver `false`,
- não terminar a tempo.

Qualquer outro resultado é considerado correto. `DatabaseService.ping()` executa `SELECT 1` e lança um erro se o PostgreSQL não responder.

Verifique apenas o que impede de atender requisições. Se a sua aplicação consegue funcionar sem um serviço, por exemplo mostrando dados antigos quando um cache falha, não o inclua: a queda dele deixaria toda a aplicação sem tráfego.

Evite também verificar APIs de terceiros. Se uma cair, todas as suas instâncias deixam de estar prontas ao mesmo tempo, e a sua aplicação para de responder a tudo.

## O que quem chama vê

Essas rotas são públicas, mesmo que a aplicação tenha um [guard de autenticação](../../core/guards/#o-guard-de-autenticação), porque quem as chama não tem sessão. Por isso não dão detalhes. Se uma verificação falhar, a resposta é apenas:

```json
{ "status": "unavailable" }
```

Qual verificação falhou, e por quê, vai para o [logger](../../core/providers/#use-seu-próprio-logger), que é onde você vai procurar:

```txt
[Health] The health check "database" failed
```

Assim, a resposta não revela qual infraestrutura você usa nem o conteúdo dos erros, que muitas vezes inclui endereços internos. Se você não quer expor as rotas na internet, não as publique no seu proxy: as sondas do Kubernetes chamam a aplicação diretamente.

## Opções

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `checks` | `{}` | As verificações, com o nome delas para o log. |
| `timeoutMs` | `3_000` | Quanto cada verificação pode demorar. Se demorar mais, ela falha. |
| `cacheMs` | `1_000` | Por quanto tempo o último resultado é reutilizado. Com `0`, verifica a cada requisição. |

Como `/ready` é pública, qualquer pessoa poderia chamá-la em loop para sobrecarregar o seu banco de dados. Por isso as requisições simultâneas compartilham uma única execução das verificações, e o resultado é reutilizado durante `cacheMs`. Com o valor padrão, cada instância as executa no máximo uma vez por segundo, não importa quantas requisições receba.

Mantenha `timeoutMs` abaixo do tempo que a sua sonda espera por uma resposta. Caso contrário, a sonda desiste antes de o viga responder.

### Outras rotas

As rotas são indicadas no segundo argumento, porque o viga precisa conhecê-las antes de criar os providers:

```ts
HealthModule.forRoot(options, { path: '/live', readyPath: '/status' });
```

Como as demais rotas, elas levam o [`globalPrefix`](../../core/controllers/) da aplicação: com `globalPrefix: '/api'`, ficam em `/api/health` e `/api/ready`.

## Com Kubernetes

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

A aplicação começa a responder quando termina de iniciar, depois dos `onModuleInit`, então `startupProbe` lhe dá até um minuto para isso sem que `livenessProbe` a reinicie.

### Ao implantar uma nova versão

`/ready` não avisa que a aplicação está sendo encerrada. Ao receber `SIGTERM`, [`close()`](../../core/app-lifecycle/#parar) para de aceitar conexões imediatamente, e o Kubernetes pode levar alguns segundos para parar de enviar tráfego, então algumas requisições falhariam.

Por isso o exemplo usa `preStop`: ele espera 5 segundos antes de enviar `SIGTERM`, para que o Kubernetes retire a instância enquanto ela ainda atende requisições. Ajuste `terminationGracePeriodSeconds` para incluir essa espera e o tempo que as requisições em andamento levam para terminar. O comando precisa de `sleep` na imagem; as imagens mínimas, como as *distroless*, não o trazem.

## Com Docker

As imagens do Node.js nem sempre trazem `curl`, mas trazem o Node.js:

```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
```

## Limites de requisições

As sondas são requisições normais, então contam para um [`rateLimit()`](../../security/rate-limiting/#para-toda-a-aplicação) global, e um 429 em `/ready` é tratado como uma falha. Com uma sonda a cada poucos segundos e um limite razoável, isso não é um problema, mas leve em conta se o limite for muito baixo.

## Nos testes

`/ready` é testada como qualquer rota com [`createTestingApp`](../testing/). Para simular uma falha, substitua `HEALTH_OPTIONS`:

```ts title="test/health.test.ts"
import { HEALTH_OPTIONS } from '@vigajs/core/health';
import { createTestingApp } from '@vigajs/core/testing';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: HEALTH_OPTIONS, useValue: { checks: { database: () => false } } }],
});

const response = await app.request('/ready');
assert.equal(response.status, 503);

await app.close();
```

Se você precisar do mesmo resultado no seu código, `HealthService` está disponível com `inject()` e o método `isReady()` devolve `true` ou `false`.
