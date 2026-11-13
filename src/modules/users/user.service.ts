import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { DAY, HOUR, MINUTE } from '../../lib/time.js';
import type { LoginInput, LoginResponse, PublicUser, RegisterInput } from './user.model.js';
import { hashPassword, placeholderPasswordHash, verifyPassword } from './user.password.js';
import type { UserRepository } from './user.repository.js';
import { createSessionToken, hashToken, isWellFormedToken } from './user.token.js';

export const TERMS_VERSION = '2026-11-13';

const TOUCH_INTERVAL = 5 * MINUTE;

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
      return await this.repository.createPatient({
        fullName,
        email,
        phone,
        passwordHash,
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
    const limit = candidate.isProtected ? null : this.policy.maxSessionsPerUser;
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
    return { sessionId: session.id, user: session.user };
  }

  logout(sessionId: string): Promise<void> {
    return this.repository.deleteSession(sessionId);
  }

  private idleExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.policy.idleHours * HOUR, absoluteExpiresAt.getTime()));
  }
}
