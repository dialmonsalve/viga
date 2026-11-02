---
title: '@vigajs/core/crypto'
description: Store passwords with Argon2id, generate random tokens, sign URLs with an expiry and encrypt data with AES-256-GCM, with no dependencies to install.
sidebar:
  order: 9
---

`@vigajs/core/crypto` gathers the cryptographic operations almost every API needs, so you don't have to choose algorithms and parameters on your own. It only uses `node:crypto`, so there's nothing to install.

| For | Use | Needs keys |
| --- | --- | --- |
| [Storing passwords](#passwords) | `hashPassword`, `verifyPassword`, `needsRehash` | No |
| [Tokens for links and API keys](#random-tokens) | `randomToken`, `hashToken`, `safeEqual` | No |
| [Temporary links](#signed-urls) | `UrlSigner`, `@Signed()` | Yes |
| [Encrypting data you have to get back](#encryption) | `Encryptor` | Yes |

## Passwords

A password is never stored or encrypted: you store its hash, which it can't be recovered from. `hashPassword` uses Argon2id with the minimum configuration [recommended by OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): 19 MiB of memory, 2 iterations and 1 thread.

```ts title="src/users/users.service.ts"
import { Injectable, inject } from '@vigajs/core';
import { hashPassword, needsRehash, randomToken, verifyPassword } from '@vigajs/core/crypto';
import { UsersRepository } from './users.repository.ts';

@Injectable()
export class UsersService {
  private readonly users = inject(UsersRepository);
  private readonly dummyHash = hashPassword(randomToken());

  async register(email: string, password: string) {
    return this.users.create({ email, passwordHash: await hashPassword(password) });
  }

  async verifyCredentials(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !valid) return undefined;

    if (needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await hashPassword(password));
    }
    return user;
  }
}
```

The result of `hashPassword` has a standard format that includes the salt and the parameters, so a text column is enough:

```txt
$argon2id$v=19$m=19456,t=2,p=1$JXd7mQ0pW1i9wR0dNwQbyw$SjGh1rmvb4Br3Pq0C...
```

Notice three details in the example:

- **`dummyHash`:** if the email doesn't exist and you responded right away, the response time would reveal which emails are registered. That's why a hash is also computed in that case.
- **`needsRehash`:** it returns `true` if the hash was created with other parameters. Since you have the plain password at that moment, you can update it. That way, hashes improve on their own when viga raises its parameters.
- **`verifyPassword`:** it returns `false` if the password doesn't match or the hash is malformed, without throwing an error.

Passwords are normalized with NFKC before hashing. An `ñ` can be encoded in two ways depending on the device, and without this the same password wouldn't match.

### Protect login

Each hash takes up 19 MiB and one thread of the Node.js pool, which has 4 by default. While they're busy, other operations that use them also wait, like reading files. That's why login needs a [rate limit](../../security/rate-limiting/#per-route):

```ts
@Public()
@Post('/login')
@RateLimit({ max: 5, windowMs: 15 * 60_000 })
@Validate({ body: Login })
```

Also validate the password with a maximum length in your schema, like `z.string().min(12).max(128)`.

### Migrate from bcrypt

There's no need to ask users to change their password. Keep your bcrypt library during the migration and update each hash when the user logs in:

```ts
import bcrypt from 'bcrypt';

function checkPassword(password: string, stored: string) {
  return stored.startsWith('$2') ? bcrypt.compare(password, stored) : verifyPassword(password, stored);
}
```

Use `checkPassword` instead of `verifyPassword`. `needsRehash` returns `true` for a bcrypt hash, so the previous code replaces it automatically. Users who don't log in again keep their bcrypt hash: decide how long you keep the library and what you do with them afterwards.

## Random tokens

`randomToken` generates an unpredictable value for recovery links, invitations or API keys. Store only its hash, so a database leak doesn't let anyone use them:

```ts
import { hashToken, randomToken } from '@vigajs/core/crypto';

const token = randomToken();
await this.resets.create({ tokenHash: hashToken(token), userId, expiresAt });
await this.mail.sendResetLink(user.email, token);
```

When you receive it, look it up by its hash, check it hasn't expired and delete it so it only works once:

```ts
const reset = await this.resets.findByHash(hashToken(token));
if (!reset || reset.expiresAt <= new Date()) throw new BadRequestException('auth.invalidToken');
await this.resets.delete(reset.id);
```

`randomToken` generates 32 bytes by default and doesn't accept fewer than 16. `hashToken` uses SHA-256, which is enough here because the token is already random. **Don't use it for passwords**, which need a slow hash like `hashPassword`.

### Compare secrets

`===` stops as soon as it finds a difference, and that time can help guess a secret. `safeEqual` takes the same time whatever the content or the length:

```ts
if (!safeEqual(req.headers['x-webhook-secret']?.toString() ?? '', this.config.WEBHOOK_SECRET)) {
  throw new UnauthorizedException();
}
```

## The keys

Signed URLs and encryption need keys. Declare them in your [`@vigajs/core/config`](../config/) schema, with a minimum of 32 characters:

```ts title="src/config.ts"
export const Env = z.object({
  SIGNING_KEY: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
});
```

Generate each one with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

And import `CryptoModule` in the root module. It's a global module, and you only need the options for what you use:

```ts title="src/app.module.ts"
import { inject } from '@vigajs/core';
import { CONFIG } from '@vigajs/core/config';
import { CryptoModule } from '@vigajs/core/crypto';

CryptoModule.forRoot(() => {
  const config = inject(CONFIG);

  return {
    signingKeys: [config.SIGNING_KEY],
    encryption: { active: 'k1', keys: { k1: config.ENCRYPTION_KEY } },
  };
}),
```

viga doesn't start if a key has fewer than 32 bytes, and the error names the key without showing its value. That check only measures length: a phrase like `my-company-secret-key-for-the-year-2026` passes it, so always generate random values.

## Signed URLs

A signed URL gives temporary access to a route without logging in, for example to download an invoice from an email:

```ts title="src/invoices/invoices.controller.ts"
import { Controller, Get, Public, inject, type HttpContext } from '@vigajs/core';
import { Signed, UrlSigner } from '@vigajs/core/crypto';

@Controller('/invoices')
export class InvoicesController {
  private readonly signer = inject(UrlSigner);

  @Get('/:id/link')
  link({ params }: HttpContext) {
    return { url: this.signer.sign(`/invoices/${params.id}/pdf`, { expiresInSeconds: 3600 }) };
  }

  @Public()
  @Signed()
  @Get('/:id/pdf')
  download({ params }: HttpContext) {
    return this.invoices.pdf(Number(params.id));
  }
}
```

`sign` returns the path with two more parameters:

```txt
/invoices/42/pdf?expires=1793577600&signature=Kq3vX0m...
```

`@Signed()` responds 403 if the signature isn't valid or the URL has expired. The signature covers the path, the parameters, the expiry and the method, so `42` can't be changed to `43` and no parameters can be added. By default, a signed URL only works for `GET` and `HEAD`. For another method, use `sign(path, { expiresInSeconds, method: 'DELETE' })`.

To check a signature without `@Signed()`, use `signer.verify(url, { method })`, which returns `true` or `false`.

:::caution
The link works for anyone who has it until it expires, and it can end up in the browser history or in logs. Use short expiries and don't use it for actions that have to check who performs them. A specific link can't be revoked: for that, use a [token stored in your database](#random-tokens).
:::

Also keep in mind:

- **Sign the path the server receives.** With `globalPrefix: '/api'`, sign `/api/invoices/42/pdf`, and if a proxy changes the path before it reaches the app, the signature won't match.
- **Only paths are signed**, with no domain. Add the domain when building the link: `` `https://my-app.com${url}` ``.
- **`@Public()` is needed** if the link is opened without a session. Without it, the route requires authentication as well as the signature.

## Encryption

Encrypt data you have to get back, like the API keys of a provider that each company configures in your app. If you only need to check a value, use a hash.

```ts title="src/providers/provider-keys.service.ts"
import { Injectable, inject } from '@vigajs/core';
import { Encryptor } from '@vigajs/core/crypto';

@Injectable()
export class ProviderKeysService {
  private readonly encryptor = inject(Encryptor);
  private readonly keys = inject(ProviderKeysRepository);

  save(tenantId: number, apiKey: string) {
    const encrypted = this.encryptor.encrypt(apiKey, { context: `tenant:${tenantId}` });
    return this.keys.upsert(tenantId, encrypted);
  }

  async read(tenantId: number) {
    const encrypted = await this.keys.find(tenantId);
    return this.encryptor.decrypt(encrypted, { context: `tenant:${tenantId}` });
  }
}
```

`encrypt` uses AES-256-GCM and returns a text that records which key was used. Encrypting the same value twice gives different results:

```txt
v1.k1.Yp3Xb0mR2kQfVt8u.Hn2cJ9w4.9aX0qLm3Rt7KvB1sZc2YwQ
```

`decrypt` throws an error if the value has been altered, if it can't be decrypted with any key or if the context doesn't match. The message is always the same and gives no further details.

**The context binds the value to its owner.** It isn't stored in the result, but it has to match when decrypting. Without it, someone with write access to the table could copy another company's encrypted key into their own, and your app would decrypt it for them.

Encrypting doesn't replace controlling who accesses the data: your app decrypts whatever it's asked to, so keep checking permissions. You also can't search or sort by an encrypted column.

:::danger
If you lose an encryption key, you lose everything encrypted with it. Keep it as carefully as a backup, and outside the database it protects.
:::

## Rotate keys

You can change a key without invalidating what already exists.

**To sign**, put the new one first. It signs with the first and verifies with all of them:

```ts
signingKeys: [config.SIGNING_KEY_NEW, config.SIGNING_KEY],
```

Remove the old one once its links have expired. If a key has leaked, remove it immediately: its links will stop working, but no one will be able to create more.

**To encrypt**, add the new one with another name and activate it. It encrypts with `active` and decrypts with any of them:

```ts
encryption: {
  active: 'k2',
  keys: { k1: config.ENCRYPTION_KEY, k2: config.ENCRYPTION_KEY_NEW },
},
```

Keep `k1` until you've decrypted and re-encrypted all the values that use it. To find them, look for the ones that start with `v1.k1.`.

Each value uses a random 12-byte number, so don't encrypt more than about 4 billion values with the same key: from there on, a repeat starts to be a real risk. Rotate the key long before reaching that.

## In tests

Pass test keys by replacing `CRYPTO_OPTIONS`:

```ts title="test/invoices.test.ts"
import { CRYPTO_OPTIONS, UrlSigner } from '@vigajs/core/crypto';
import { createTestingApp } from '@vigajs/core/testing';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: CRYPTO_OPTIONS, useValue: { signingKeys: ['k'.repeat(32)] } }],
});

const url = app.get(UrlSigner).sign('/invoices/42/pdf', { expiresInSeconds: 60 });
assert.equal((await app.request(url)).status, 200);
assert.equal((await app.request('/invoices/42/pdf')).status, 403);

await app.close();
```
