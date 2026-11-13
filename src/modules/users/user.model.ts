import '../../docs/zod-extend.js';
import { z } from 'zod';
import { roles } from '../../database/schema/users.js';
import { registry } from '../../docs/registry.js';

const E164 = /^\+[1-9][0-9]{9,14}$/;

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) return `+${digits}`;
  return digits.length === 10 || digits.length === 11 ? `+55${digits}` : `+${digits}`;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export const personName = z
  .string()
  .trim()
  .refine((value) => !hasControlCharacter(value), 'O nome não pode ter caracteres de controle.')
  .refine((value) => [...value].length >= 2 && [...value].length <= 120, 'O nome precisa ter entre 2 e 120 caracteres.')
  .openapi({ description: 'Nome completo, de 2 a 120 caracteres.', example: 'Ana Maria Silva' });

const email = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email({ error: 'Informe um e-mail válido.' }).max(254, 'O e-mail pode ter até 254 caracteres.'))
  .openapi({ example: 'ana.silva@email.com' });

const phoneNumber = z
  .string()
  .trim()
  .min(1, 'Informe um telefone válido com DDD.')
  .transform(normalizePhone)
  .pipe(z.string().regex(E164, 'Informe um telefone válido com DDD.'));

const phoneDescription = {
  description: 'Telefone com DDD. Números brasileiros sem código do país ganham `+55`; é gravado em E.164.',
  example: '(11) 98765-4321',
};

const phone = z
  .union([z.literal('').transform(() => undefined), phoneNumber])
  .optional()
  .openapi(phoneDescription);

const password = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .max(128, 'A senha pode ter até 128 caracteres.')
  .openapi({ example: 'senha-segura-123' });

const confirmationMatches = (data: { password: string; passwordConfirmation: string }) =>
  data.password === data.passwordConfirmation;
const confirmationIssue = { path: ['passwordConfirmation'], message: 'As senhas não conferem.' };

export const registerSchema = registry.register(
  'RegisterRequest',
  z
    .strictObject({
      fullName: personName,
      email,
      phone,
      password,
      passwordConfirmation: z.string().openapi({ example: 'senha-segura-123' }),
      acceptTerms: z
        .literal(true, {
          error: 'É preciso aceitar os termos de uso e a política de privacidade.',
        })
        .openapi({
          description: 'Aceite dos termos de uso e da política de privacidade em vigor.',
        }),
    })
    .refine(confirmationMatches, confirmationIssue),
);

export const updateProfileSchema = registry.register(
  'UpdateProfileRequest',
  z
    .strictObject({
      fullName: personName.optional(),
      phone: z
        .union([z.null(), z.literal('').transform(() => null), phoneNumber])
        .optional()
        .openapi({ ...phoneDescription, description: `${phoneDescription.description} Envie \`null\` para remover.` }),
    })
    .refine((data) => data.fullName !== undefined || data.phone !== undefined, {
      path: ['_root'],
      message: 'Envie o nome ou o telefone.',
    }),
);

export const changePasswordSchema = registry.register(
  'ChangePasswordRequest',
  z
    .strictObject({
      currentPassword: z.string().min(1, 'Informe a senha atual.').max(128).openapi({ example: 'senha-segura-123' }),
      password,
      passwordConfirmation: z.string().openapi({ example: 'nova-senha-segura-456' }),
    })
    .refine(confirmationMatches, confirmationIssue),
);

export const sessionSchema = registry.register(
  'Session',
  z.object({
    id: z.uuid(),
    current: z.boolean().openapi({ description: 'Se é a sessão que fez esta requisição.' }),
    userAgent: z.string().nullable().openapi({ example: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' }),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
);

export const loginSchema = registry.register(
  'LoginRequest',
  z.strictObject({
    email,
    password: z.string().min(1, 'Informe a senha.').max(128).openapi({ example: 'senha-segura-123' }),
    remember: z.boolean().default(false).openapi({
      description: '"Lembrar de mim": a sessão dura 7 dias em vez de 12 horas sem uso.',
    }),
  }),
);

export const publicUserSchema = registry.register(
  'User',
  z.object({
    id: z.uuid(),
    fullName: z.string().openapi({ example: 'Ana Maria Silva' }),
    email: z.string().openapi({ example: 'ana.silva@email.com' }),
    phone: z.string().nullable().openapi({ example: '+5511987654321' }),
    roles: z.array(z.enum(roles)).openapi({
      description: 'Perfis que a conta possui.',
      example: ['patient'],
    }),
  }),
);

export const loginResponseSchema = registry.register(
  'LoginResponse',
  z.object({
    token: z.string().openapi({
      description: 'Token de sessão, enviado depois como `Authorization: Bearer <token>`.',
    }),
    expiresAt: z.iso.datetime().openapi({
      description: 'Quando a sessão expira se não for usada antes.',
    }),
    user: publicUserSchema,
  }),
);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SessionView = z.infer<typeof sessionSchema>;
