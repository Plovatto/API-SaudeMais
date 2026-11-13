import { AppError } from '../../lib/app-error.js';
import { unauthenticated } from '../../middleware/auth.js';
import type { Clock } from '../../lib/clock.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { DAY, HOUR, MINUTE } from '../../lib/time.js';
import type {
  ChangePasswordInput,
  LoginInput,
  LoginResponse,
  PublicUser,
  RegisterInput,
  SessionView,
  UpdateProfileInput,
} from './user.model.js';
import { hashPassword, placeholderPasswordHash, verifyPassword } from './user.password.js';
import type { SeedAccount } from './user.demo.js';
import type { UserRepository } from './user.repository.js';
import { createSessionToken, hashToken, isWellFormedToken } from './user.token.js';

export const TERMS_VERSION = '2026-11-13';

const TOUCH_INTERVAL = 5 * MINUTE;
const PROTECTED_SESSION_LIMIT = 500;

export interface SessionPolicy {
  idleHours: number;
  maxDays: number;
  maxSessionsPerUser: number;
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthContext {
  sessionId: string;
  isProtected: boolean;
  user: PublicUser;
}

export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly clock: Clock,
    private readonly policy: SessionPolicy,
  ) {}

  async register({ fullName, email, phone, password }: RegisterInput): Promise<PublicUser> {
    const passwordHash = await hashPassword(password);
    try {
      return await this.repository.createUser({
        fullName,
        email,
        phone,
        passwordHash,
        roles: ['patient'],
        isProtected: false,
        termsVersion: TERMS_VERSION,
        now: this.clock.now(),
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) {
        const message = 'Este e-mail já está cadastrado.';
        throw new AppError(409, 'EMAIL_TAKEN', message, { email: message });
      }
      throw error;
    }
  }

  async login({ email, password, remember }: LoginInput, client: ClientInfo): Promise<LoginResponse> {
    const candidate = await this.repository.findLoginCandidate(email);
    const valid = await verifyPassword(password, candidate?.passwordHash ?? (await placeholderPasswordHash()));
    if (!candidate || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    if (candidate.deactivatedAt) throw new AppError(403, 'USER_INACTIVE', 'Esta conta está desativada.');

    const now = this.clock.now();
    const absoluteExpiresAt = new Date(now.getTime() + this.policy.maxDays * DAY);
    const remembered = remember && !candidate.isProtected;
    const expiresAt = remembered ? absoluteExpiresAt : this.idleExpiry(now, absoluteExpiresAt);
    const { token, tokenHash } = createSessionToken();
    const sessionId = await this.repository.createSession({
      userId: candidate.id,
      tokenHash,
      remember: remembered,
      userAgent: client.userAgent,
      ip: client.ip,
      createdAt: now,
      expiresAt,
      absoluteExpiresAt,
    });
    const limit = candidate.isProtected ? PROTECTED_SESSION_LIMIT : this.policy.maxSessionsPerUser;
    await this.repository.pruneSessions(candidate.id, sessionId, now, limit);

    const { passwordHash: _hash, isProtected: _protected, deactivatedAt: _deactivated, ...user } = candidate;
    return { token, expiresAt: expiresAt.toISOString(), user };
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    if (!isWellFormedToken(token)) return null;
    const now = this.clock.now();
    const session = await this.repository.findActiveSession(hashToken(token), now);
    if (!session) return null;
    if (now.getTime() - session.lastUsedAt.getTime() >= TOUCH_INTERVAL) {
      const expiresAt = session.remember ? session.absoluteExpiresAt : this.idleExpiry(now, session.absoluteExpiresAt);
      await this.repository.touchSession(session.id, now, expiresAt);
    }
    return { sessionId: session.id, isProtected: session.isProtected, user: session.user };
  }

  async ensureAccount({ fullName, email, password, roles, isProtected }: SeedAccount): Promise<void> {
    const now = this.clock.now();
    const existing = await this.repository.findLoginCandidate(email);
    if (existing) {
      if (existing.isProtected !== isProtected) {
        throw new Error(`Seed account ${email} already exists with a different protection setting`);
      }
      const missing = roles.filter((role) => !existing.roles.includes(role));
      if (missing.length === 0) return;
      if (existing.deactivatedAt || !(await verifyPassword(password, existing.passwordHash))) {
        throw new Error(`${email} belongs to an existing account whose password does not match`);
      }
      await this.repository.grantRoles(existing.id, missing, now);
      return;
    }
    const passwordHash = await hashPassword(password);
    try {
      await this.repository.createUser({
        fullName,
        email,
        phone: undefined,
        passwordHash,
        roles,
        isProtected,
        termsVersion: null,
        now,
      });
    } catch (error) {
      if (!isUniqueViolation(error, 'users_email_key')) throw error;
    }
  }

  async profile(userId: string): Promise<PublicUser> {
    const user = await this.repository.findPublicUser(userId);
    if (!user) throw unauthenticated();
    return user;
  }

  async updateProfile(userId: string, { fullName, phone }: UpdateProfileInput): Promise<PublicUser> {
    await this.repository.updateProfile(userId, {
      ...(fullName !== undefined && { fullName }),
      ...(phone !== undefined && { phone }),
    });
    return this.profile(userId);
  }

  async changePassword({ sessionId, user }: AuthContext, { currentPassword, password }: ChangePasswordInput) {
    const stored = await this.repository.findPasswordHash(user.id);
    if (!stored || !(await verifyPassword(currentPassword, stored))) {
      const message = 'A senha atual está incorreta.';
      throw new AppError(422, 'INVALID_CURRENT_PASSWORD', message, { currentPassword: message });
    }
    await this.repository.updatePasswordHash(user.id, await hashPassword(password));
    await this.repository.deleteSessionsOf(user.id, sessionId);
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

  logoutEverywhere({ sessionId, isProtected, user }: AuthContext): Promise<void> {
    return isProtected ? this.repository.deleteSession(sessionId) : this.repository.deleteSessionsOf(user.id, null);
  }

  logout(sessionId: string): Promise<void> {
    return this.repository.deleteSession(sessionId);
  }

  private idleExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.policy.idleHours * HOUR, absoluteExpiresAt.getTime()));
  }
}
