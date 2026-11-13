import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Semaphore } from '../../lib/semaphore.js';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const MAX_MEMORY = 64 * 1024 * 1024;
const hashing = new Semaphore(2);

function derive(password: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  return hashing.run(
    () =>
      new Promise((resolve, reject) => {
        scrypt(password.normalize('NFKC'), salt, length, { ...options, maxmem: MAX_MEMORY }, (error, key) => {
          if (error) reject(error);
          else resolve(key);
        });
      }),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS, KEY_LENGTH);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  if (expected.length === 0) return false;
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: +n, r: +r, p: +p }, expected.length);
  return timingSafeEqual(actual, expected);
}

let placeholderHash: Promise<string> | undefined;

export function placeholderPasswordHash(): Promise<string> {
  placeholderHash ??= hashPassword(randomBytes(16).toString('hex'));
  return placeholderHash;
}
