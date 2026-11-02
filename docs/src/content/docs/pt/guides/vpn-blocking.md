---
title: Bloquear VPNs
description: Rejeite conexões vindas de faixas de IP conhecidas de VPN com uma lista local ou uma API externa, e conheça os limites dessa detecção.
sidebar:
  order: 5
---

Algumas aplicações precisam limitar o acesso por VPN, por exemplo para frear o abuso de testes gratuitos ou cumprir restrições por país. O viga não traz nada específico para isso, porque se resolve com peças que ele já tem: um provider que sabe quais IPs são de uma VPN e um guard que rejeita essas requisições.

:::caution
Uma requisição não indica que vem de uma VPN. Tudo o que você pode fazer é comparar o IP dela com faixas conhecidas, e isso falha nos dois sentidos:

- **Deixa conexões passarem:** nenhuma lista cobre todas as VPNs, os provedores mudam de IP e um proxy residencial usa IPs de casas comuns.
- **Bloqueia quem não deve:** um IP dessas faixas também pode ser de uma empresa ou de alguém que usa uma VPN por privacidade.

Use isso para reduzir o abuso, não como controle de segurança. O que precisa estar protegido também precisa de autenticação e permissões.
:::

## Escolha de onde vem a informação

| Opção | Vantagens | Desvantagens |
| --- | --- | --- |
| Lista local de faixas | Sem dependências nem chamadas externas a cada requisição, e o IP não sai do seu servidor. | Fica defasada entre as atualizações. |
| Banco de dados comercial, como o [GeoIP Anonymous IP](https://www.maxmind.com/en/geoip-anonymous-ip-database) | É consultado localmente e tem um provedor responsável pelos dados. | Tem custo e exige um leitor próprio. |
| API externa, como o [IPinfo](https://ipinfo.io/proxy-vpn-detection-api) | Dados atualizados pelo provedor, muitas vezes com mais sinais. | Adiciona latência e uma dependência, e envia o IP dos seus usuários a um terceiro. |

Se a sua CDN ou o seu proxy já oferece esse bloqueio, considere-o primeiro: as requisições são rejeitadas antes de chegar à sua aplicação.

Este guia constrói a primeira opção e depois mostra como trocá-la por uma API.

## Antes de começar: o IP correto

Tudo depende de `req.ip`. Se a aplicação está atrás de um proxy, configure [`trustProxy`](../../security/client-ip/) com o número exato de proxies:

- **Sem configurar**, `req.ip` é o IP do seu proxy, que não está em nenhuma lista, então você nunca bloquearia ninguém.
- **Com `trustProxy: true`**, o cliente escolhe o IP com `X-Forwarded-For`, então pode escapar do bloqueio em cada requisição.

## A lista de faixas

O exemplo usa [X4BNet/lists_vpn](https://github.com/X4BNet/lists_vpn), uma lista pública que é atualizada automaticamente. A pasta `output/vpn` contém uma faixa por linha, como `2.26.8.0/22`, em um arquivo para IPv4 e outro para IPv6. A pasta `output/datacenter` adiciona os data centers, mas isso também bloquearia servidores legítimos, como os que enviam webhooks.

:::note
Esse repositório não declara nenhuma licença. Revise as condições dele antes de usá-lo em um produto, e considere que quem mantém uma lista decide quem você bloqueia: uma faixa ampla demais pode deixar de fora usuários legítimos.
:::

`BlockList`, de `node:net`, verifica se um IP pertence a alguma das faixas, sem instalar nada:

```ts title="src/vpn/vpn-list.service.ts"
import { BlockList, isIP } from 'node:net';
import { Injectable, LOGGER, inject, type OnModuleDestroy, type OnModuleInit } from '@vigajs/core';

const SOURCE = 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn';
const ONE_DAY = 24 * 60 * 60_000;

async function addRanges(list: BlockList, url: string, family: 'ipv4' | 'ipv6') {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);

  const ranges = (await response.text()).split('\n').map((line) => line.trim()).filter(Boolean);
  if (ranges.length === 0) throw new Error(`${url} is empty`);

  for (const range of ranges) {
    const [address, prefix] = range.split('/');
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
}

@Injectable()
export class VpnListService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = inject(LOGGER);
  private list = new BlockList();
  private timer?: NodeJS.Timeout;

  async onModuleInit() {
    await this.refresh();

    this.timer = setInterval(() => {
      this.refresh().catch((error) => this.logger.error('Could not refresh the VPN list', error));
    }, ONE_DAY);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  isVpn(ip: string | undefined) {
    if (!ip) return false;
    return this.list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
  }

  private async refresh() {
    const next = new BlockList();
    await addRanges(next, `${SOURCE}/ipv4.txt`, 'ipv4');
    await addRanges(next, `${SOURCE}/ipv6.txt`, 'ipv6');
    this.list = next;
  }
}
```

A lista nova só substitui a anterior quando foi baixada e lida por inteiro. Assim, se uma atualização falhar, a aplicação continua com a última lista boa.

Se o primeiro download falhar, `onModuleInit` lança o erro e a aplicação não inicia. Para que uma implantação não dependa de um serviço externo, guarde uma cópia da lista no seu próprio armazenamento e baixe-a de lá.

`check` percorre as faixas, mas é rápido: com cerca de 11 000, leva por volta de 60 microssegundos por chamada.

## O guard

```ts title="src/vpn/no-vpn.guard.ts"
import { ForbiddenException, Injectable, inject, type CanActivate, type HttpContext } from '@vigajs/core';
import { VpnListService } from './vpn-list.service.ts';

@Injectable()
export class NoVpnGuard implements CanActivate {
  private readonly vpn = inject(VpnListService);

  canActivate({ req }: HttpContext) {
    if (this.vpn.isVpn(req.ip)) throw new ForbiddenException('O acesso por VPN não é permitido');
    return true;
  }
}
```

Use uma exceção com uma mensagem em vez de devolver `false`: quem usa uma VPN sem má intenção entende o que precisa fazer. Se o frontend precisar distinguir este 403 dos demais, use um [código próprio](../../core/exceptions/#seus-próprios-códigos-e-mensagens).

Crie um módulo global para o serviço. Ele precisa ser global para ser usado também em [WebSocket](#websocket):

```ts title="src/vpn/vpn.module.ts"
import { Module } from '@vigajs/core';
import { VpnListService } from './vpn-list.service.ts';

@Module({
  providers: [VpnListService],
  exports: [VpnListService],
  global: true,
})
export class VpnModule {}
```

Importe-o no módulo raiz e coloque o guard apenas nas rotas que precisam dele:

```ts title="src/auth/auth.controller.ts"
@Public()
@Post('/register')
@UseGuards(NoVpnGuard)
@Validate({ body: Register })
register({ body }: HttpContext<{ body: typeof Register }>) {
  return this.users.register(body);
}
```

## Bloquear toda a aplicação

Se você realmente precisa bloquear todas as rotas, use um middleware:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

app.use((req, _res, next) => {
  if (app.get(VpnListService).isVpn(req.ip)) {
    throw new ForbiddenException('O acesso por VPN não é permitido');
  }
  next();
});

await app.listen();
```

É melhor começar pelas rotas específicas. Um bloqueio global também afeta as rotas públicas e os serviços externos que chamam a sua API, como pagamentos ou webhooks, se os IPs deles estiverem na lista.

## Meça antes de bloquear

Antes de rejeitar alguém, ative o guard por um tempo apenas para contar. Assim você vê quantas requisições legítimas seriam afetadas:

```ts
canActivate({ req }: HttpContext) {
  if (this.vpn.isVpn(req.ip)) this.logger.info(`VPN request to ${req.path}`);
  return true;
}
```

Decida também o que fará um usuário legítimo que você bloquear, como entrar em contato com o suporte ou desativar a VPN, e informe essa saída na mensagem de erro.

## Com uma API externa

Para usar uma API, mude apenas o serviço. Como a verificação é assíncrona, `canActivate` também passa a ser, com `await this.vpn.isVpn(req.ip)`:

```ts title="src/vpn/vpn-api.service.ts"
import { Injectable, LOGGER, inject } from '@vigajs/core';
import { z } from 'zod';

const VpnResponse = z.object({ vpn: z.boolean() });

const ONE_HOUR = 60 * 60_000;
const MAX_ENTRIES = 10_000;

@Injectable()
export class VpnApiService {
  private readonly logger = inject(LOGGER);
  private readonly cache = new Map<string, { vpn: boolean; expiresAt: number }>();

  async isVpn(ip: string | undefined) {
    if (!ip) return false;

    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.vpn;

    try {
      const response = await fetch(`https://api.example.com/ip/${encodeURIComponent(ip)}`, {
        headers: { authorization: `Bearer ${process.env.VPN_API_KEY}` },
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) throw new Error(`The VPN API responded ${response.status}`);

      const { vpn } = VpnResponse.parse(await response.json());
      this.remember(ip, vpn);
      return vpn;
    } catch (error) {
      this.logger.error('Could not check the IP', error);
      return false;
    }
  }

  private remember(ip: string, vpn: boolean) {
    this.cache.delete(ip);
    if (this.cache.size >= MAX_ENTRIES) {
      for (const oldest of this.cache.keys()) {
        this.cache.delete(oldest);
        break;
      }
    }
    this.cache.set(ip, { vpn, expiresAt: Date.now() + ONE_HOUR });
  }
}
```

A URL e o campo `vpn` são de exemplo: adapte-os ao seu provedor. As demais decisões valem para qualquer um:

- **Um tempo máximo curto:** se a API demorar, ela não atrasa suas rotas em mais de um segundo.
- **O que fazer se falhar:** aqui a requisição passa, para que uma queda do provedor não bloqueie todos os seus usuários. Se o bloqueio for mais importante que a disponibilidade, rejeite a requisição.
- **Um cache com limite:** evita uma chamada a cada requisição, e o limite impede que alguém encha a memória trocando de IP.
- **Apenas nas rotas necessárias:** cada IP novo gasta cota do provedor, então um atacante poderia esgotá-la. Escreva um [`@RateLimit()`](../../security/rate-limiting/#por-rota) acima do guard: entre decoradores do mesmo tipo, o de cima é executado primeiro, então uma requisição que ultrapasse o limite não chega a chamar a API.

Um IP pode ser considerado um dado pessoal. Antes de enviá-lo a um terceiro ou guardá-lo nos logs, revise a legislação que se aplica à sua aplicação.

## WebSocket

O handshake de um WebSocket não passa pelos middlewares nem por `@UseGuards()`. Verifique em `authenticate`, que é executado em cada conexão:

```ts title="src/app.module.ts"
WebSocketModule.forRoot(() => {
  const vpn = inject(VpnListService);
  const clientIp = inject(CLIENT_IP);

  return {
    authenticate: async (req) => {
      if (vpn.isVpn(clientIp(req))) return false;

      return verifySession(req);
    },
  };
}),
```

`authenticate` recebe a requisição do Node.js, sem `req.ip`. [`CLIENT_IP`](../../security/client-ip/#websocket) devolve o mesmo IP que `req.ip`, de acordo com o seu `trustProxy`.

Devolver `false` rejeita a conexão com 401. A verificação só ocorre ao conectar, então uma conexão já aberta continua funcionando mesmo que o IP dela entre depois na lista.

## Tor e proxies

Esta lista cobre VPNs, não toda forma de ocultar o IP. O Tor publica a [lista dos seus nós de saída](https://check.torproject.org/torbulkexitlist), com um IP por linha, e `addRanges` também consegue lê-la:

```ts
await addRanges(next, 'https://check.torproject.org/torbulkexitlist', 'ipv4');
```

Para os proxies abertos e residenciais, o habitual é recorrer a um provedor comercial.
