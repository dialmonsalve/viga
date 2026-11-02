import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';

const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const MAX_MEMORY_KIB = 1_048_576;
const MAX_PASSES = 64;
const MAX_PARALLELISM = 64;
const MIN_SALT_BYTES = 8;
const MIN_HASH_BYTES = 16;

const FORMAT = /^\$argon2id\$v=19\$m=(\d{1,8}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ParsedHash {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

function derive(password: string, salt: Buffer, params: Omit<Argon2Parameters, 'message' | 'nonce'>) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      { ...params, message: password.normalize('NFKC'), nonce: salt },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
}

function encode(bytes: Buffer) {
  return bytes.toString('base64').replace(/=+$/, '');
}

function parse(stored: string): ParsedHash | undefined {
  const match = FORMAT.exec(stored);
  if (!match) return undefined;

  const [, memory, passes, parallelism, salt, hash] = match;
  const parsed = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt ?? '', 'base64'),
    hash: Buffer.from(hash ?? '', 'base64'),
  };

  const valid =
    parsed.parallelism >= 1 &&
    parsed.parallelism <= MAX_PARALLELISM &&
    parsed.passes >= 1 &&
    parsed.passes <= MAX_PASSES &&
    parsed.memory >= 8 * parsed.parallelism &&
    parsed.memory <= MAX_MEMORY_KIB &&
    parsed.salt.length >= MIN_SALT_BYTES &&
    parsed.hash.length >= MIN_HASH_BYTES;

  return valid ? parsed : undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, {
    memory: MEMORY_KIB,
    passes: PASSES,
    parallelism: PARALLELISM,
    tagLength: HASH_BYTES,
  });
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${encode(salt)}$${encode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  const actual = await derive(password, parsed.salt, {
    memory: parsed.memory,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
    tagLength: parsed.hash.length,
  });
  return timingSafeEqual(actual, parsed.hash);
}

export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return (
    !parsed ||
    parsed.memory !== MEMORY_KIB ||
    parsed.passes !== PASSES ||
    parsed.parallelism !== PARALLELISM ||
    parsed.salt.length !== SALT_BYTES ||
    parsed.hash.length !== HASH_BYTES
  );
}
