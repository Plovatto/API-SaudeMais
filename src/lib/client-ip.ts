import { isIP } from 'node:net';
import type { Request } from 'express';

export function clientIp(req: Request): string | null {
  return req.ip && isIP(req.ip) ? req.ip : null;
}
