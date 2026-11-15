import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newPublicCode(): string {
  return `EX-${Array.from({ length: 6 }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('')}`;
}
