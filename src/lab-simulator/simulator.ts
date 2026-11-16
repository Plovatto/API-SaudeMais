import { parseArgs } from 'node:util';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Clock } from '../lib/clock.js';
import { civilDate, CLINIC_TIME_ZONE, DAY, wallClockIn } from '../lib/time.js';
import { civilDay } from '../modules/doctors/doctors.model.js';
import type { LabClient } from './client.js';
import { simulationOf } from './models.js';

const configSchema = z.object({
  LAB_API_URL: z.url({ protocol: /^https?$/, error: 'Set the API base URL, like https://api.example.com' }),
  LAB_API_KEY: z.string({ error: 'Set the key created in Admin > Integrações' }).startsWith('slab_', {
    error: 'Use the key created in Admin > Integrações, which starts with slab_',
  }),
  date: civilDay.optional(),
  amendChance: z.coerce.number({ error: 'Use a number from 0 to 1' }).min(0).max(1).default(0),
});

export interface SimulatorConfig {
  apiUrl: string;
  apiKey: string;
  date: string;
  amendChance: number;
}

export function parseSimulatorConfig(
  args: string[],
  env: Record<string, string | undefined>,
  now: Date,
): SimulatorConfig {
  const { values } = parseArgs({
    args,
    options: { date: { type: 'string' }, 'amend-chance': { type: 'string' } },
    strict: true,
  });
  const parsed = configSchema.safeParse({
    LAB_API_URL: env.LAB_API_URL || undefined,
    LAB_API_KEY: env.LAB_API_KEY || undefined,
    date: values.date,
    amendChance: values['amend-chance'],
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid lab simulator configuration\n- ${problems.join('\n- ')}`);
  }
  const { LAB_API_URL, LAB_API_KEY, date, amendChance } = parsed.data;
  return {
    apiUrl: LAB_API_URL,
    apiKey: LAB_API_KEY,
    date: date ?? civilDate(wallClockIn(CLINIC_TIME_ZONE, now) - DAY),
    amendChance,
  };
}

interface SimulatorDeps {
  client: Pick<LabClient, 'worklist' | 'publish'>;
  clock: Clock;
  logger: Logger;
}

export async function simulate({ date, amendChance }: SimulatorConfig, { client, clock, logger }: SimulatorDeps) {
  const tally = { created: 0, unchanged: 0, amended: 0, skipped: 0, failed: 0 };
  const worklist = await client.worklist(date);
  for (const entry of worklist) {
    const simulation = simulationOf(entry, clock.now(), amendChance);
    if (!simulation) {
      logger.warn({ examTypeCode: entry.examTypeCode }, 'No result model for this exam type; skipped');
      tally.skipped += 1;
      continue;
    }
    for (const result of [simulation.result, simulation.amendment]) {
      if (!result) continue;
      const outcome = await client.publish(result);
      if (typeof outcome === 'string') {
        tally[outcome] += 1;
        continue;
      }
      logger.warn({ examCode: result.examCode, ...outcome }, 'Lab result was not published');
      tally.failed += 1;
      break;
    }
  }
  logger.info({ date, exams: worklist.length, ...tally }, 'Lab simulation finished');
  return tally;
}
