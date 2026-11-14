export function seedTarget(nodeEnv: string, databaseUrl: string, allowProduction: string | undefined): string {
  if (nodeEnv === 'production' && allowProduction !== '1') {
    throw new Error('Refusing to seed with NODE_ENV=production; set SEED_ALLOW_PRODUCTION=1 to confirm');
  }
  return new URL(databaseUrl).hostname;
}
