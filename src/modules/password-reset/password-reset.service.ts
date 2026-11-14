import type { AuditEntry } from '../../lib/audit.js';
import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { CLINIC_TIME_ZONE, MINUTE, startOfDayIn } from '../../lib/time.js';
import type { MailQueue } from '../../mail/index.js';
import { hashPassword } from '../users/user.password.js';
import type { UserRepository } from '../users/user.repository.js';
import type { SessionCache } from '../users/user.session-cache.js';
import { createSessionToken, hashToken } from '../users/user.token.js';
import { resetEmail } from './password-reset.mail.js';
import type { ResetConfirmInput, ResetRequestInput } from './password-reset.model.js';
import type { PasswordResetRepository } from './password-reset.repository.js';

export const RESET_TOKEN_MINUTES = 30;

export class PasswordResetService {
  constructor(
    private readonly resets: PasswordResetRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionCache,
    private readonly mail: MailQueue,
    private readonly clock: Clock,
    private readonly appUrl: string,
  ) {}

  async request({ email }: ResetRequestInput): Promise<void> {
    const user = await this.users.findLoginCandidate(email);
    if (!user || user.isProtected || user.deactivatedAt) return;
    await this.sendLink(user, null);
  }

  async sendLink(
    user: { id: string; email: string },
    requestedBy: string | null,
    audit?: AuditEntry,
  ): Promise<boolean> {
    const now = this.clock.now();
    const { token, tokenHash } = createSessionToken();
    const issued = await this.resets.issue({
      userId: user.id,
      requestedBy,
      tokenHash,
      now,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_MINUTES * MINUTE),
      dayStart: startOfDayIn(CLINIC_TIME_ZONE, now),
      audit,
    });
    if (issued) {
      this.mail.enqueue(resetEmail(user.email, `${this.appUrl}/redefinir-senha#token=${token}`, RESET_TOKEN_MINUTES));
    }
    return issued;
  }

  async confirm({ token, password }: ResetConfirmInput): Promise<void> {
    const passwordHash = await hashPassword(password);
    const userId = await this.resets.consume(hashToken(token), passwordHash, this.clock.now());
    if (!userId) {
      const message = 'Este link é inválido ou já venceu. Peça um novo.';
      throw new AppError(400, 'INVALID_RESET_TOKEN', message, { token: message });
    }
    this.sessions.invalidateUser(userId);
  }
}
