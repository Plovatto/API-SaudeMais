import '../../docs/zod-extend.js';
import { z } from 'zod';
import { registry } from '../../docs/registry.js';
import { email, password, passwordConfirmationMatches } from '../users/user.model.js';
import { TOKEN_PATTERN } from '../users/user.token.js';

export const resetRequestSchema = registry.register('PasswordResetRequest', z.strictObject({ email }));

export const resetConfirmSchema = registry.register(
  'PasswordResetConfirmation',
  z
    .strictObject({
      token: z.string().regex(TOKEN_PATTERN, 'Link inválido ou vencido.').openapi({
        description: 'Token recebido no link do e-mail, depois de `#token=`.',
        example: 'q8Zr3VtYw1mN0pLk7sXc2bHf9dGj4uEa6oIi5nRy_-T',
      }),
      password,
      passwordConfirmation: z.string().openapi({ example: 'nova-senha-segura-456' }),
    })
    .refine(...passwordConfirmationMatches),
);

export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;
