import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/modules/users/user.password.js';

describe('password hashing', () => {
  it('stores the scrypt parameters with a random salt', async () => {
    const [first, second] = await Promise.all([hashPassword('senha-segura-123'), hashPassword('senha-segura-123')]);

    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(first).not.toBe(second);
  });

  it('accepts the right password and refuses others', async () => {
    const stored = await hashPassword('senha-segura-123');

    expect(await verifyPassword('senha-segura-123', stored)).toBe(true);
    expect(await verifyPassword('senha-segura-124', stored)).toBe(false);
  });

  it('treats equivalent Unicode spellings as the same password', async () => {
    const stored = await hashPassword('ação-segura');

    expect(await verifyPassword('ação-segura', stored)).toBe(true);
  });

  it.each(['', 'plain-text', 'bcrypt$1$2$3$a$b', 'scrypt$65536$8$1$c2FsdA==$'])(
    'refuses a malformed stored hash (%s)',
    async (stored) => {
      expect(await verifyPassword('senha-segura-123', stored)).toBe(false);
    },
  );
});
