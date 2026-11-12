import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(`CORS origin: ${env.CORS_ORIGIN}`);
});

server.on('error', (err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
