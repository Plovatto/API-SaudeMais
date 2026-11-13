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

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido.' }).max(254, 'O e-mail pode ter até 254 caracteres.'))
  .openapi({ example: 'ana.silva@email.com' });

const phone = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : normalizePhone(value)))
  .pipe(z.string().regex(E164, 'Informe um telefone válido com DDD.').optional())
  .optional()
  .openapi({
    description: 'Telefone com DDD. Números brasileiros sem código do país ganham `+55`; é gravado em E.164.',
    example: '(11) 98765-4321',
  });

export const registerSchema = registry.register(
  'RegisterRequest',
  z
    .strictObject({
      fullName: z
        .string()
        .trim()
        .min(2, 'Informe o nome completo.')
        .max(120, 'O nome pode ter até 120 caracteres.')
        .openapi({ example: 'Ana Maria Silva' }),
      email,
      phone,
      password: z
        .string()
        .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
        .max(128, 'A senha pode ter até 128 caracteres.')
        .openapi({ example: 'senha-segura-123' }),
      passwordConfirmation: z.string().openapi({ example: 'senha-segura-123' }),
      acceptTerms: z
        .literal(true, {
          error: 'É preciso aceitar os termos de uso e a política de privacidade.',
        })
        .openapi({
          description: 'Aceite dos termos de uso e da política de privacidade em vigor.',
        }),
    })
    .refine((data) => data.password === data.passwordConfirmation, {
      path: ['passwordConfirmation'],
      message: 'As senhas não conferem.',
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
