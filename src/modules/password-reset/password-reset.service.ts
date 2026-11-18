import type { AfterCommit, Database } from '../../database/pg-client.js';
import type { AuditEntry } from '../../lib/audit.js';
import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { CLINIC_TIME_ZONE, MINUTE, startOfDayIn } from '../../lib/time.js';
import type { MailQueue } from '../../mail/index.js';
import { hashPassword } from '../users/user.password.js';
import type { UserRepository } from '../users/user.repository.js';
import type { SessionCache } from '../users/user.session-cache.js';
import { createSessionToken, hashToken } from '../users/user.token.js';
import { resetEmail, welcomeEmail } from './password-reset.mail.js';
import type { ResetConfirmInput, ResetRequestInput } from './password-reset.model.js';
import type { PasswordResetRepository } from './password-reset.repository.js';

export const RESET_TOKEN_MINUTES = 30;
export const WELCOME_TOKEN_HOURS = 72;

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
    if (!user || user.deactivatedAt) return;
    await this.sendLink(user, null);
  }

  async sendLink(
    user: { id: string; email: string },
    requestedBy: string | null,
    audit?: AuditEntry,
  ): Promise<boolean> {
    const { link, ...token } = this.newToken(RESET_TOKEN_MINUTES);
    const issued = await this.resets.issue({
      userId: user.id,
      requestedBy,
      ...token,
      dayStart: startOfDayIn(CLINIC_TIME_ZONE, token.now),
      audit,
    });
    if (issued) this.mail.enqueue(resetEmail(user.email, link, RESET_TOKEN_MINUTES));
    return issued;
  }

  async issueWelcome(
    tx: Pick<Database, 'insert'>,
    user: { id: string; email: string },
    requestedBy: string,
  ): Promise<AfterCommit> {
    const { link, ...token } = this.newToken(WELCOME_TOKEN_HOURS * 60);
    await this.resets.store(tx, { userId: user.id, requestedBy, ...token });
    return () => this.mail.enqueue(welcomeEmail(user.email, link, WELCOME_TOKEN_HOURS));
  }

  private newToken(minutes: number) {
    const now = this.clock.now();
    const { token, tokenHash } = createSessionToken();
    return {
      tokenHash,
      now,
      expiresAt: new Date(now.getTime() + minutes * MINUTE),
      link: `${this.appUrl}/redefinir-senha#token=${token}`,
    };
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
