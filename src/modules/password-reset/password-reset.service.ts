import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { MINUTE, startOfDayIn } from '../../lib/time.js';
import type { MailQueue } from '../../mail/index.js';
import { hashPassword } from '../users/user.password.js';
import type { UserRepository } from '../users/user.repository.js';
import { createSessionToken, hashToken } from '../users/user.token.js';
import { resetEmail } from './password-reset.mail.js';
import type { ResetConfirmInput, ResetRequestInput } from './password-reset.model.js';
import type { PasswordResetRepository } from './password-reset.repository.js';

export const RESET_TOKEN_MINUTES = 30;
const TIME_ZONE = 'America/Sao_Paulo';

export class PasswordResetService {
  constructor(
    private readonly resets: PasswordResetRepository,
    private readonly users: UserRepository,
    private readonly mail: MailQueue,
    private readonly clock: Clock,
    private readonly appUrl: string,
  ) {}

  async request({ email }: ResetRequestInput): Promise<void> {
    const user = await this.users.findLoginCandidate(email);
    if (!user || user.isProtected || user.deactivatedAt) return;
    const now = this.clock.now();
    const { token, tokenHash } = createSessionToken();
    const issued = await this.resets.issue({
      userId: user.id,
      tokenHash,
      now,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_MINUTES * MINUTE),
      dayStart: startOfDayIn(TIME_ZONE, now),
    });
    if (issued)
      this.mail.enqueue(resetEmail(user.email, `${this.appUrl}/redefinir-senha#token=${token}`, RESET_TOKEN_MINUTES));
  }

  async confirm({ token, password }: ResetConfirmInput): Promise<void> {
    const passwordHash = await hashPassword(password);
    if (!(await this.resets.consume(hashToken(token), passwordHash, this.clock.now()))) {
      const message = 'Este link é inválido ou já venceu. Peça um novo.';
      throw new AppError(400, 'INVALID_RESET_TOKEN', message, { token: message });
    }
  }
}
