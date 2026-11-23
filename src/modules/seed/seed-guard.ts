import { isIP } from 'node:net';

const LOCAL_SUFFIXES = ['.local', '.localhost', '.internal'];
const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^(::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/;

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(host);
  if (version === 4) return PRIVATE_IPV4.test(host);
  if (version === 6) return PRIVATE_IPV6.test(host);
  return host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function seedTarget(
  nodeEnv: string,
  databaseUrl: string,
  allowProduction: string | undefined,
  allowRemote?: string,
): string {
  const { hostname } = new URL(databaseUrl);
  if (nodeEnv === 'production') {
    if (allowProduction !== '1') {
      throw new Error('Refusing to seed with NODE_ENV=production; set SEED_ALLOW_PRODUCTION=1 to confirm');
    }
    return hostname;
  }
  if (!isLocalHost(hostname) && allowRemote !== '1') {
    throw new Error(`Refusing to seed the remote database ${hostname}; set SEED_ALLOW_REMOTE=1 to confirm`);
  }
  return hostname;
}
