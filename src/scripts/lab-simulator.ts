import 'dotenv/config';
import { createLogger } from '../config/create-logger.js';
import { LabClient } from '../lab-simulator/client.js';
import { parseSimulatorConfig, simulate } from '../lab-simulator/simulator.js';
import { systemClock } from '../lib/clock.js';

const logger = createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'info' });

try {
  const config = parseSimulatorConfig(process.argv.slice(2), process.env, systemClock.now());
  const tally = await simulate(config, { client: new LabClient(config), clock: systemClock, logger });
  if (tally.failed > 0) process.exitCode = 1;
} catch (err) {
  logger.fatal({ err }, 'Lab simulation failed');
  process.exitCode = 1;
}
