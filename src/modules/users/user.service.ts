import type { AfterCommit, Transaction } from '../../database/pg-client.js';
import type { Role } from '../../database/schema/users.js';
import { AppError, invalidData, notFound, unprocessable, unprocessableField } from '../../lib/app-error.js';
import { unauthenticated } from '../../middleware/auth.js';
import type { Clock } from '../../lib/clock.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { definedFields } from '../../lib/defined.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { CLINIC_TIME_ZONE, DAY, HOUR, MINUTE, civilDateIn } from '../../lib/time.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type {
  ChangePasswordInput,
  LoginInput,
  LoginResponse,
  Profile,
  PublicUser,
  RegisterInput,
  SessionView,
  UpdateProfileInput,
} from './user.model.js';
import {
  birthDateInFuture,
  currentSession,
  emailConflicts,
  invalidCredentials,
  invalidCurrentPassword,
  sessionNotFound,
  userInactive,
} from './user.messages.js';
import { hashPassword, placeholderPasswordHash, verifyPassword } from './user.password.js';
import type { NewUser, UserRepository } from './user.repository.js';
import type { SessionCache } from './user.session-cache.js';
import { createSessionToken, hashToken, isWellFormedToken } from './user.token.js';

export const TERMS_VERSION = '2026-11-13';

export const TOUCH_INTERVAL = 5 * MINUTE;

export interface SessionPolicy {
  idleHours: number;
  maxDays: number;
  maxSessionsPerUser: number;
}

interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthContext {
  sessionId: string;
  user: PublicUser;
}

export interface SeedAccount {
  fullName: string;
  email: string;
  password: string;
  roles: Role[];
}

class SeedAccountConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedAccountConflictError';
  }
}

export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly clock: Clock,
    private readonly policy: SessionPolicy,
    private readonly notifications: NotificationsService,
    private readonly sessions: SessionCache,
  ) {}

  async register({ fullName, email, phone, password }: RegisterInput): Promise<PublicUser> {
    const passwordHash = await hashPassword(password);
    return this.createAccount(
      { fullName, email, phone, passwordHash, roles: ['patient'], termsVersion: TERMS_VERSION },
      (tx, user) => this.notifications.notifyAdmins(tx, { type: 'user_registered', params: { userId: user.id } }),
    );
  }

  async createAccount(
    account: Omit<NewUser, 'now'>,
    onCreated: (tx: Transaction, user: PublicUser) => Promise<AfterCommit>,
  ): Promise<PublicUser> {
    return withConstraintConflicts(
      () => this.repository.createUser({ ...account, now: this.clock.now() }, onCreated),
      emailConflicts,
    );
  }

  async login({ email, password, remember }: LoginInput, client: ClientInfo): Promise<LoginResponse> {
    const now = this.clock.now();
    const candidate = await this.repository.findLoginCandidate(email);
    const valid = await verifyPassword(password, candidate?.passwordHash ?? (await placeholderPasswordHash()));
    if (!candidate || !valid) throw new AppError(401, invalidCredentials.code, invalidCredentials.message);
    if (candidate.deactivatedAt) throw new AppError(403, userInactive.code, userInactive.message);

    const absoluteExpiresAt = new Date(now.getTime() + this.policy.maxDays * DAY);
    const expiresAt = remember ? absoluteExpiresAt : this.idleExpiry(now, absoluteExpiresAt);
    const { token, tokenHash } = createSessionToken();
    const sessionId = await this.repository.createSession({
      userId: candidate.id,
      tokenHash,
      remember,
      userAgent: client.userAgent,
      ip: client.ip,
      createdAt: now,
      expiresAt,
      absoluteExpiresAt,
    });
    this.sessions.invalidateSessions(
      await this.repository.pruneSessions(candidate.id, sessionId, now, this.policy.maxSessionsPerUser),
    );

    const { passwordHash: _hash, deactivatedAt: _deactivated, ...user } = candidate;
    return { token, expiresAt: expiresAt.toISOString(), user };
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    if (!isWellFormedToken(token)) return null;
    const now = this.clock.now();
    const tokenHash = hashToken(token);
    const session = await this.sessions.resolve(tokenHash, () => this.repository.findActiveSession(tokenHash, now));
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.invalidate(tokenHash);
      return null;
    }
    if (now.getTime() - session.lastUsedAt.getTime() >= TOUCH_INTERVAL) {
      const expiresAt = session.remember ? session.absoluteExpiresAt : this.idleExpiry(now, session.absoluteExpiresAt);
      await this.repository.touchSession(session.id, now, expiresAt);
      Object.assign(session, { lastUsedAt: now, expiresAt });
    }
    return { sessionId: session.id, user: session.user };
  }

  async ensureAccount({ fullName, email, password, roles }: SeedAccount): Promise<boolean> {
    const now = this.clock.now();
    const existing = await this.repository.findLoginCandidate(email);
    if (existing) {
      const missing = roles.filter((role) => !existing.roles.includes(role));
      if (missing.length === 0) return false;
      if (existing.deactivatedAt || !(await verifyPassword(password, existing.passwordHash))) {
        throw new SeedAccountConflictError(`${email} belongs to an existing account whose password does not match`);
      }
      await this.repository.grantRoles(existing.id, missing, now);
      return false;
    }
    const passwordHash = await hashPassword(password);
    try {
      await this.repository.createUser({
        fullName,
        email,
        phone: undefined,
        passwordHash,
        roles,
        termsVersion: null,
        now,
      });
      return true;
    } catch (error) {
      if (!isUniqueViolation(error, 'users_email_key')) throw error;
      return false;
    }
  }

  async profile(userId: string): Promise<Profile> {
    const user = await this.repository.findProfile(userId);
    if (!user) throw unauthenticated();
    return user;
  }

  async updateProfile(userId: string, { fullName, phone, birthDate }: UpdateProfileInput): Promise<Profile> {
    if (birthDate && birthDate > civilDateIn(CLINIC_TIME_ZONE, this.clock.now())) {
      throw invalidData(birthDateInFuture);
    }
    await this.repository.updateProfile(userId, definedFields({ fullName, phone, birthDate }));
    this.sessions.invalidateUser(userId);
    return this.profile(userId);
  }

  async changePassword({ sessionId, user }: AuthContext, { currentPassword, password }: ChangePasswordInput) {
    const now = this.clock.now();
    const stored = await this.repository.findPasswordHash(user.id);
    if (!stored || !(await verifyPassword(currentPassword, stored))) {
      throw unprocessableField(invalidCurrentPassword);
    }
    await this.repository.replacePassword(user.id, await hashPassword(password), sessionId, now);
    this.sessions.invalidateUser(user.id);
  }

  async listSessions({ sessionId, user }: AuthContext): Promise<SessionView[]> {
    const rows = await this.repository.listActiveSessions(user.id, this.clock.now());
    return rows.map((row) => ({
      id: row.id,
      current: row.id === sessionId,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  async logoutEverywhere({ user }: AuthContext): Promise<void> {
    await this.repository.deleteSessionsOf(user.id, null);
    this.sessions.invalidateUser(user.id);
  }

  async endSession({ sessionId, user }: AuthContext, id: string): Promise<void> {
    if (id === sessionId) throw unprocessable(currentSession.code, currentSession.message);
    if (!(await this.repository.deleteOwnSession(user.id, id))) {
      throw notFound(sessionNotFound);
    }
    this.sessions.invalidateSessions([id]);
  }

  async endOtherSessions({ sessionId, user }: AuthContext): Promise<void> {
    await this.repository.deleteSessionsOf(user.id, sessionId);
    this.sessions.invalidateUser(user.id);
  }

  async logout(sessionId: string): Promise<void> {
    await this.repository.deleteSession(sessionId);
    this.sessions.invalidateSessions([sessionId]);
  }

  private idleExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.policy.idleHours * HOUR, absoluteExpiresAt.getTime()));
  }
}
