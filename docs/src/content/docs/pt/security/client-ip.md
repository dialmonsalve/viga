---
title: IP do cliente e proxies
description: Como o viga obtém o IP real do cliente quando a aplicação está atrás de um proxy ou de um balanceador, e como configurar trustProxy sem que possa ser falsificado.
sidebar:
  order: 3
---

O viga usa o IP do cliente em vários lugares: o [limite de requisições](../rate-limiting/), o limite de conexões por cliente do [WebSocket](../../optional/websocket/#limites-por-padrão) e `req.ip` nos seus controllers. Se esse IP estiver errado, esses limites se aplicam a quem não deveriam. Esta página explica como obtê-lo corretamente.

## O problema

Em produção, sua aplicação quase nunca recebe as requisições diretamente. Na frente costuma haver um proxy ou um balanceador: nginx, Cloudflare, o balanceador do seu provedor ou o *ingress* do Kubernetes. Para a aplicação, todas as requisições vêm do IP desse proxy.

Para não perder o IP original, cada proxy o adiciona ao final do cabeçalho `X-Forwarded-For`. Com um único proxy na frente, a requisição chega assim:

```txt
X-Forwarded-For: 203.0.113.7
```

Mas esse cabeçalho pode ser escrito por qualquer um. Um cliente pode enviar seu próprio `X-Forwarded-For` com um IP inventado, e o proxy adiciona o real no final:

```txt
X-Forwarded-For: 6.6.6.6, 203.0.113.7
```

`6.6.6.6` foi escrito pelo cliente; `203.0.113.7` foi adicionado pelo seu proxy. Só o segundo é confiável. Para saber qual é o certo, o viga precisa saber quantos proxies seus há na frente.

## `trustProxy`

`trustProxy` diz ao viga em quais proxies confiar. Ele é passado para `createApp`:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 });
```

Com o cabeçalho `X-Forwarded-For: 6.6.6.6, 203.0.113.7`, cada valor dá um IP diferente:

| `trustProxy` | IP do cliente | Quando usar |
| --- | --- | --- |
| Não definido (padrão) | O do proxy | Quando a aplicação recebe as requisições diretamente, sem nenhum proxy. |
| `1` | `203.0.113.7` | Com um proxy na frente. É o mais comum. |
| `2` | `6.6.6.6` | Com dois proxies na frente, por exemplo Cloudflare e depois nginx. Com um único proxy real, pega o IP inventado. |
| Endereços, como `'loopback'` ou `['10.0.0.0/8']` | `203.0.113.7` se o proxy estiver nessas redes | Quando você conhece os endereços dos seus proxies. É o mais rígido. |
| `true` | `6.6.6.6` | Nunca. Pega o primeiro valor, que o cliente controla. |

O número precisa coincidir exatamente com os proxies que há na frente: se você colocar mais do que tem, o viga pega um IP que o cliente escreveu.

### Por que não `trustProxy: true`

Com `true`, o viga confia em todo `X-Forwarded-For` e pega o primeiro valor, que é o que o cliente escreve. Qualquer um poderia mudar de IP a cada requisição e contornar o limite de requisições. Por isso, se você o usar, o viga mostra um aviso ao iniciar:

```txt
[App] trustProxy: true takes the client IP from the first X-Forwarded-For value, which the client can forge to bypass rate limits; use the number of proxies in front of the app (for example 1) or their addresses
```

## Como saber quantos proxies você tem

Se não tiver certeza, crie uma rota temporária que mostre o que chega e chame-a pelo navegador em produção:

```ts
@Public()
@Get('/debug/ip')
ip({ req }: HttpContext) {
  return { ip: req.ip, forwardedFor: req.headers['x-forwarded-for'] };
}
```

Conte os IPs de `forwardedFor`: com um proxy você verá um, o seu; com dois, verá dois. Ajuste `trustProxy` até que `ip` seja o seu IP público e depois **apague a rota**.

## Se a aplicação também é acessível diretamente

`trustProxy: 1` confia no último salto de `X-Forwarded-For`, seja quem for que o envie. Se a sua aplicação também aceita conexões diretas, sem passar pelo proxy, um atacante pode se conectar diretamente e enviar seu próprio `X-Forwarded-For` com um único IP inventado, e o viga o aceitaria como verdadeiro.

Para evitar isso, faça uma destas duas coisas:

- **Feche o acesso direto**, com um firewall ou uma rede privada, para que só o proxy possa chegar à aplicação. É o recomendado.
- **Confie por endereços em vez de por número**, com as redes do seu proxy: `trustProxy: ['10.0.0.0/8']`. Assim o viga só lê `X-Forwarded-For` quando a requisição vem realmente dessas redes.

## WebSocket

O limite de conexões por cliente do WebSocket usa o mesmo IP e o mesmo `trustProxy`. Se um handshake trouxer `X-Forwarded-For` mas `trustProxy` não confiar em quem o envia, o viga mostra um aviso uma vez: todos os clientes atrás desse proxy compartilhariam um único contador, e esse limite bloquearia todos ao mesmo tempo.

`trustProxy` aceita os mesmos valores que a opção `trust proxy` do Express, porque o viga a repassa como está.
