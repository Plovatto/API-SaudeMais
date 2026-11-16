import { createLogger } from './create-logger.js';
import { env } from './env.js';

export const logger = createLogger(env);
