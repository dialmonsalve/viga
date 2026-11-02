---
title: Gerar código
description: Crie um recurso completo, um módulo, um controlador ou um serviço com um comando, sem que o viga toque nos seus arquivos existentes.
sidebar:
  order: 5
---

`viga generate` cria os arquivos de uma funcionalidade nova. Ele vem incluído no pacote `@vigajs/core`, então não há mais nada para instalar. Execute-o a partir da raiz do seu projeto:

```sh
pnpm exec viga generate resource books
```

Com npm e yarn é `npx viga` e `yarn viga`, e `g` é um alias de `generate`.

| Tipo | O que cria |
| --- | --- |
| `resource` | Um módulo, um controlador com rotas CRUD, um serviço e seus esquemas |
| `module` | Um módulo |
| `controller` | Um controlador |
| `service` | Um serviço |

## Um recurso

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

O resultado compila e funciona desde o primeiro momento, com estas rotas validadas:

| Rota | O que faz |
| --- | --- |
| `GET /books` | Lista todos |
| `GET /books/:id` | Devolve um, ou 404 |
| `POST /books` | Cria um |
| `PATCH /books/:id` | Modifica um |
| `DELETE /books/:id` | Apaga um |

É um ponto de partida. Três coisas ficam nas suas mãos:

- **Registre o módulo.** O viga não edita os seus arquivos, então adicione `BooksModule` aos `imports` de `app.module.ts`.
- **Decida quem acessa.** As rotas são [privadas por padrão](../../core/guards/#rotas-privadas-por-padrão). Sem um guard de autenticação respondem 401: adicione `@Public()` ou configure `app.useAuthGuard()`.
- **Troque o armazenamento.** O serviço guarda os dados em memória, e eles se perdem ao reiniciar. Substitua-o pelo seu banco de dados.

## Validação

Os esquemas usam a biblioteca que estiver nas `dependencies` do seu `package.json`, Zod ou Valibot. Para indicá-la, ou se você usa outra, adicione `--schema zod` ou `--schema valibot`. Com outra biblioteca, você terá que reescrever `books.schemas.ts`. `module`, `controller` e `service` não precisam de nenhuma.

## Peças soltas

```sh
pnpm exec viga g module shop
pnpm exec viga g controller shop
pnpm exec viga g service shop
```

Os três arquivos ficam em `src/shop/`. Como o gerador não edita nada, ele indica onde registrar cada peça: adicione o controlador a `controllers` e o serviço a `providers`.

## Nomes e pastas

O nome fica em minúsculas, com hifens se tiver várias palavras: `order-items` cria `OrderItemsModule` e a rota `/order-items`. Os esquemas usam uma versão no singular, como `CreateOrderItem`. Essa conversão é simples e só cobre os plurais regulares do inglês, então revise-a se o nome for outro.

Para criar o recurso dentro de outra pasta, inclua-a no nome. A pasta não muda a rota da API, que continua sendo `/books`:

```sh
pnpm exec viga g resource admin/books
```

Isso cria `src/admin/books/`. Se o seu código não está em `src`, indique a pasta base com `--path`, sempre dentro do seu projeto:

```sh
pnpm exec viga g service audit --path lib
```

Cada parte do nome segue o mesmo formato, então `..` não serve para sair do projeto.

## Seus arquivos estão a salvo

O gerador nunca modifica um arquivo existente. Se algum dos que ele vai criar já existir, não cria nenhum e diz quais são.
