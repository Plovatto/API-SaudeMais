import { and, eq, gt, gte, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { AfterCommit, Database, Transaction } from '../../database/pg-client.js';
import { sessions } from '../../database/schema/sessions.js';
import { termsAcceptances, userRoles, users, type Role } from '../../database/schema/users.js';
import type { PublicUser } from './user.model.js';

const userColumns = { id: users.id, fullName: users.fullName, email: users.email, phone: users.phone };

export const publicUserColumns = {
  ...userColumns,
  roles: sql<
    Role[]
  >`array(select ${userRoles.role} from ${userRoles} where ${userRoles.userId} = ${users.id} order by ${userRoles.role})`,
};

export function hasRole(role: Role): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${userRoles} where ${userRoles.userId} = ${users.id} and ${userRoles.role} = ${role})`;
}

type Writer = Pick<Database, 'update' | 'delete'>;

export async function applyNewPassword(
  db: Writer,
  userId: string,
  passwordHash: string,
  keepSessionId: string | null,
  now: Date,
): Promise<void> {
  await db.update(users).set({ passwordHash, passwordChangedAt: now }).where(eq(users.id, userId));
  if (keepSessionId) {
    await db
      .update(sessions)
      .set({ createdAt: now })
      .where(and(eq(sessions.id, keepSessionId), gt(sessions.expiresAt, now)));
  }
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), keepSessionId ? ne(sessions.id, keepSessionId) : undefined));
}

export interface NewUser {
  fullName: string;
  email: string;
  phone: string | undefined;
  passwordHash: string;
  roles: Role[];
  isProtected: boolean;
  termsVersion: string | null;
  now: Date;
}

export interface LoginCandidate extends PublicUser {
  passwordHash: string;
  isProtected: boolean;
  deactivatedAt: Date | null;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  remember: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface ActiveSession {
  id: string;
  remember: boolean;
  lastUsedAt: Date;
  absoluteExpiresAt: Date;
  isProtected: boolean;
  user: PublicUser;
}

export class UserRepository {
  constructor(private readonly db: Database) {}

  async createUser(
    { fullName, email, phone, passwordHash, roles, isProtected, termsVersion, now }: NewUser,
    onCreated?: (tx: Transaction, user: PublicUser) => Promise<AfterCommit>,
  ): Promise<PublicUser> {
    const [user, afterCommit] = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ fullName, email, phone, passwordHash, isProtected })
        .returning(userColumns);
      if (!row) throw new Error('User insert returned no row');
      await tx.insert(userRoles).values(roles.map((role) => ({ userId: row.id, role, grantedAt: now })));
      if (termsVersion) await tx.insert(termsAcceptances).values({ userId: row.id, termsVersion, acceptedAt: now });
      const created = { ...row, roles: [...roles].sort() };
      return [created, await onCreated?.(tx, created)] as const;
    });
    afterCommit?.();
    return user;
  }

  async grantRoles(userId: string, roles: Role[], now: Date): Promise<void> {
    await this.db
      .insert(userRoles)
      .values(roles.map((role) => ({ userId, role, grantedAt: now })))
      .onConflictDoNothing();
  }

  async findLoginCandidate(email: string): Promise<LoginCandidate | undefined> {
    const [candidate] = await this.db
      .select({
        ...publicUserColumns,
        passwordHash: users.passwordHash,
        isProtected: users.isProtected,
        deactivatedAt: users.deactivatedAt,
      })
      .from(users)
      .where(eq(users.email, email));
    return candidate;
  }

  async findPublicUser(id: string): Promise<PublicUser | undefined> {
    const [user] = await this.db.select(publicUserColumns).from(users).where(eq(users.id, id));
    return user;
  }

  async findPasswordHash(id: string): Promise<string | undefined> {
    const [user] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id));
    return user?.passwordHash;
  }

  async updateProfile(id: string, changes: { fullName?: string; phone?: string | null }): Promise<void> {
    await this.db.update(users).set(changes).where(eq(users.id, id));
  }

  replacePassword(id: string, passwordHash: string, keepSessionId: string, now: Date): Promise<void> {
    return this.db.transaction((tx) => applyNewPassword(tx, id, passwordHash, keepSessionId, now));
  }

  async listActiveSessions(userId: string, now: Date) {
    return this.db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
      .orderBy(sql`${sessions.lastUsedAt} desc`);
  }

  async deleteSessionsOf(userId: string, exceptId: string | null): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), exceptId ? ne(sessions.id, exceptId) : undefined));
  }

  async createSession(session: NewSession): Promise<string> {
    const [created] = await this.db
      .insert(sessions)
      .values({ ...session, lastUsedAt: session.createdAt })
      .returning({ id: sessions.id });
    if (!created) throw new Error('Session insert returned no row');
    return created.id;
  }

  async pruneSessions(userId: string, keepId: string, now: Date, limit: number): Promise<void> {
    const overLimit = sql`${sessions.id} not in (select ${sessions.id} from ${sessions} where ${sessions.userId} = ${userId} and ${sessions.id} <> ${keepId} and ${sessions.expiresAt} > ${now} order by ${sessions.lastUsedAt} desc, ${sessions.id} desc limit ${limit - 1})`;
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, keepId), or(lte(sessions.expiresAt, now), overLimit)));
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveSession | undefined> {
    const [row] = await this.db
      .select({
        id: sessions.id,
        remember: sessions.remember,
        lastUsedAt: sessions.lastUsedAt,
        absoluteExpiresAt: sessions.absoluteExpiresAt,
        isProtected: users.isProtected,
        user: publicUserColumns,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, now),
          isNull(users.deactivatedAt),
          or(isNull(users.passwordChangedAt), gte(sessions.createdAt, users.passwordChangedAt)),
        ),
      );
    return row;
  }

  async touchSession(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ lastUsedAt, expiresAt }).where(eq(sessions.id, id));
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}
