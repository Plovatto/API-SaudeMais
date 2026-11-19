import type { AfterCommit, Database } from '../../database/pg-client.js';
import type { AuditEntry } from '../../lib/audit.js';
import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { EXAMPLE_ACCOUNT_ID } from '../../lib/example-account.js';
import { CLINIC_TIME_ZONE, HOUR, MINUTE, startOfDayIn } from '../../lib/time.js';
import type { MailQueue } from '../../mail/index.js';
import { hashPassword } from '../users/user.password.js';
import type { UserRepository } from '../users/user.repository.js';
import type { SessionCache } from '../users/user.session-cache.js';
import { createSessionToken, hashToken } from '../users/user.token.js';
import { resetEmail, welcomeEmail } from './password-reset.mail.js';
import type { ResetConfirmInput, ResetRequestInput } from './password-reset.model.js';
import type { PasswordResetRepository } from './password-reset.repository.js';

const RESET_TOKEN_MINUTES = 30;
export const INVALID_RESET_TOKEN_MESSAGE = 'Este link é inválido ou já venceu. Peça um novo.';
export const WELCOME_TOKEN_HOURS = 72;
export const RESET_ACCOUNT_NOT_FOUND_MESSAGE = 'Não encontramos uma conta com este e-mail.';
export const RESET_TOO_SOON_MESSAGE =
  'Já enviamos um link há pouco. Confira seu e-mail e o spam, ou tente de novo em alguns minutos.';

function accountNotFound(): AppError {
  return new AppError(404, 'ACCOUNT_NOT_FOUND', RESET_ACCOUNT_NOT_FOUND_MESSAGE, {
    email: RESET_ACCOUNT_NOT_FOUND_MESSAGE,
  });
}

function invalidResetToken(): AppError {
  return new AppError(400, 'INVALID_RESET_TOKEN', INVALID_RESET_TOKEN_MESSAGE, { token: INVALID_RESET_TOKEN_MESSAGE });
}

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
    if (!user || user.deactivatedAt) throw accountNotFound();
    if (!(await this.sendLink(user, null))) throw new AppError(429, 'RESET_TOO_SOON', RESET_TOO_SOON_MESSAGE);
  }

  async sendLink(
    user: { id: string; email: string },
    requestedBy: string | null,
    audit?: AuditEntry,
  ): Promise<boolean> {
    if (user.id === EXAMPLE_ACCOUNT_ID) return true;
    const { link, ...token } = this.newToken(RESET_TOKEN_MINUTES * MINUTE);
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
    const { link, ...token } = this.newToken(WELCOME_TOKEN_HOURS * HOUR);
    await this.resets.store(tx, { userId: user.id, requestedBy, purpose: 'welcome', ...token });
    return () => this.mail.enqueue(welcomeEmail(user.email, link, WELCOME_TOKEN_HOURS));
  }

  private newToken(lifetimeMs: number) {
    const now = this.clock.now();
    const { token, tokenHash } = createSessionToken();
    return {
      tokenHash,
      now,
      expiresAt: new Date(now.getTime() + lifetimeMs),
      link: `${this.appUrl}/redefinir-senha#token=${token}`,
    };
  }

  async confirm({ token, password }: ResetConfirmInput): Promise<void> {
    const tokenHash = hashToken(token);
    if (!(await this.resets.isUsable(tokenHash, this.clock.now()))) throw invalidResetToken();
    const passwordHash = await hashPassword(password);
    const userId = await this.resets.consume(tokenHash, passwordHash, this.clock.now());
    if (!userId) throw invalidResetToken();
    this.sessions.invalidateUser(userId);
  }
}
