import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { sessions } from '../../database/schema/sessions.js';
import { termsAcceptances, userRoles, users, type Role } from '../../database/schema/users.js';
import type { PublicUser } from './user.model.js';

const publicUserColumns = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  roles: sql<
    Role[]
  >`array(select ${userRoles.role} from ${userRoles} where ${userRoles.userId} = ${users.id} order by ${userRoles.role})`,
};

export interface NewPatient {
  fullName: string;
  email: string;
  phone: string | undefined;
  passwordHash: string;
  termsVersion: string;
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
  user: PublicUser;
}

export class UserRepository {
  constructor(private readonly db: Database) {}

  createPatient({ fullName, email, phone, passwordHash, termsVersion, now }: NewPatient): Promise<PublicUser> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ fullName, email, phone, passwordHash }).returning({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
      });
      if (!user) throw new Error('User insert returned no row');
      await tx.insert(userRoles).values({ userId: user.id, role: 'patient', grantedAt: now });
      await tx.insert(termsAcceptances).values({ userId: user.id, termsVersion, acceptedAt: now });
      return { ...user, roles: ['patient'] };
    });
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

  async createSession(session: NewSession): Promise<void> {
    await this.db.insert(sessions).values({ ...session, lastUsedAt: session.createdAt });
  }

  async keepNewestSessions(userId: string, keep: number): Promise<void> {
    await this.db
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          sql`${sessions.id} not in (select ${sessions.id} from ${sessions} where ${sessions.userId} = ${userId} order by ${sessions.lastUsedAt} desc limit ${keep})`,
        ),
      );
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveSession | undefined> {
    const [row] = await this.db
      .select({
        id: sessions.id,
        remember: sessions.remember,
        lastUsedAt: sessions.lastUsedAt,
        absoluteExpiresAt: sessions.absoluteExpiresAt,
        user: publicUserColumns,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now), isNull(users.deactivatedAt)));
    return row;
  }

  async touchSession(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ lastUsedAt, expiresAt }).where(eq(sessions.id, id));
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}
