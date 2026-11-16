import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LabClient } from '@/lab-simulator/client.js';
import { flagOf, simulationOf } from '@/lab-simulator/models.js';
import { parseSimulatorConfig, simulate, type SimulatorConfig } from '@/lab-simulator/simulator.js';
import { resultInputSchema, type ResultInput } from '@/modules/lab-integration/lab-integration.model.js';
import { captureLogger } from './support/capture-logger.js';
import { setupClinic, type Clinic } from './support/doctors.js';
import { insertExam, offerOf } from './support/exams.js';
import { as, createPatient, START } from './support/users.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const API_KEY = `slab_7f3k2q9a_${'a'.repeat(43)}`;
const ENV = { LAB_API_URL: 'https://api.saudemais.test', LAB_API_KEY: API_KEY };
const entry = (examTypeCode: string, examCode = 'EX-7F3K2Q') => ({
  examCode,
  examTypeCode,
  startsAt: '2026-11-19T13:00:00.000Z',
});
const simulated = (examTypeCode: string, examCode?: string, amendChance = 0) =>
  simulationOf(entry(examTypeCode, examCode), NOW, amendChance);

describe('result models', () => {
  it.each(['hemograma', 'glicemia', 'colesterol'])('fills %s with valid lab items', (code) => {
    const result = simulated(code)?.result;
    expect(resultInputSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ externalId: 'SIM-EX-7F3K2Q', examCode: 'EX-7F3K2Q', status: 'final' });
    expect(result?.report).toBeUndefined();
    for (const item of result?.items ?? []) {
      expect(typeof item.value).toBe('number');
      expect(item.unit).toBeTruthy();
      expect(item.referenceRange).toMatch(/\d/);
    }
  });

  it.each(['ultrassom', 'raio_x'])('writes a %s report', (code) => {
    const result = simulated(code)?.result;
    expect(resultInputSchema.parse(result)).toEqual(result);
    expect(result?.items).toBeUndefined();
    expect(result?.report).toMatch(/Achados:\n- [\s\S]+\n\nImpressão: .+\.$/);
  });

  it('skips exam types without a model', () => {
    expect(simulated('densitometria')).toBeUndefined();
  });

  it('gives the same result to the same exam and varies across exams', () => {
    expect(simulated('hemograma')).toEqual(simulated('hemograma'));
    const codes = Array.from({ length: 40 }, (_, index) => `EX-${String(index).padStart(6, 'A')}`);
    const values = new Set(codes.map((code) => simulated('glicemia', code)?.result.items?.[0]?.value));
    const flags = new Set(codes.map((code) => simulated('glicemia', code)?.result.items?.[0]?.flag));
    expect(values.size).toBeGreaterThan(20);
    expect([...flags].sort()).toEqual(['high', 'low', 'normal']);
    const reports = new Set(codes.map((code) => simulated('ultrassom', code)?.result.report));
    expect(reports.size).toBeGreaterThan(1);
  });

  it('issues the result after the exam and never after now', () => {
    const { issuedAt } = simulated('hemograma')?.result ?? {};
    expect(Date.parse(issuedAt ?? '')).toBeGreaterThan(Date.parse(entry('hemograma').startsAt));
    const early = simulationOf({ ...entry('hemograma'), startsAt: '2026-11-20T11:30:00.000Z' }, NOW, 0);
    expect(Date.parse(early?.result.issuedAt ?? '')).toBeLessThanOrEqual(NOW.getTime());
  });

  it('amends only when asked, with the same externalId and different content', () => {
    expect(simulated('hemograma', undefined, 0)?.amendment).toBeUndefined();
    for (const code of ['hemograma', 'raio_x']) {
      const { result, amendment } = simulated(code, undefined, 1) ?? {};
      expect(resultInputSchema.parse(amendment)).toEqual(amendment);
      expect(amendment).toMatchObject({
        externalId: result?.externalId,
        status: 'amended',
        issuedAt: NOW.toISOString(),
      });
      expect({ ...amendment, status: 'final', issuedAt: result?.issuedAt }).not.toEqual(result);
    }
  });

  it('flags values by the reference range, critical only beyond the critical limits', () => {
    const glucose = { name: 'Glicose', unit: 'mg/dL', decimals: 0, min: 0, max: 0, low: 70, high: 99 };
    const limits = { ...glucose, criticalLow: 50, criticalHigh: 400 };
    const upTo = { name: 'LDL', unit: 'mg/dL', decimals: 0, min: 0, max: 0, high: 129 };
    const above = { name: 'HDL', unit: 'mg/dL', decimals: 0, min: 0, max: 0, low: 40 };
    const flags = (analyte: Parameters<typeof flagOf>[0], values: number[]) =>
      values.map((value) => flagOf(analyte, value));
    expect(flags(glucose, [69.9, 70, 99, 99.1])).toEqual(['low', 'normal', 'normal', 'high']);
    expect(flags(limits, [49.9, 50, 400, 400.1])).toEqual(['critical', 'low', 'high', 'critical']);
    expect(flags(upTo, [129, 130])).toEqual(['normal', 'high']);
    expect(flags(above, [39, 40])).toEqual(['low', 'normal']);
  });
});

describe('lab client', () => {
  const result = simulated('glicemia')?.result as ResultInput;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const receipt = (outcome: string) => ({
    examCode: result.examCode,
    externalId: result.externalId,
    version: 1,
    outcome,
  });

  function clientWith(...responses: (Response | Error)[]) {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const response of responses) {
      if (response instanceof Error) fetch.mockRejectedValueOnce(response);
      else fetch.mockResolvedValueOnce(response);
    }
    const wait = vi.fn((_ms: number) => Promise.resolve());
    return { client: new LabClient({ apiUrl: ENV.LAB_API_URL, apiKey: API_KEY, fetch, wait }), fetch, wait };
  }

  it('publishes with the key and reports the outcome', async () => {
    const { client, fetch } = clientWith(json(201, receipt('created')), json(200, receipt('unchanged')));
    expect(await client.publish(result)).toBe('created');
    expect(await client.publish(result)).toBe('unchanged');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://api.saudemais.test/api/integrations/lab/results');
    expect(init).toMatchObject({ method: 'POST', headers: { 'X-Api-Key': API_KEY } });
    expect(JSON.parse(init?.body as string)).toEqual(result);
  });

  it('reports a conflict without retrying', async () => {
    const { client, fetch } = clientWith(json(409, { code: 'RESULT_FINAL', message: 'Já publicado.' }));
    expect(await client.publish(result)).toEqual({ failed: 409, code: 'RESULT_FINAL' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('waits for the rate limit window and tries again once', async () => {
    const { client, fetch, wait } = clientWith(
      json(429, { code: 'TOO_MANY_REQUESTS' }, { 'Retry-After': '12' }),
      json(201, receipt('created')),
    );
    expect(await client.publish(result)).toBe('created');
    expect(wait).toHaveBeenCalledWith(12_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once on server and network errors', async () => {
    const recovered = clientWith(json(503, {}), json(201, receipt('created')));
    expect(await recovered.client.publish(result)).toBe('created');
    const down = clientWith(json(500, {}), json(502, { code: 'BAD_GATEWAY' }));
    expect(await down.client.publish(result)).toEqual({ failed: 502, code: 'BAD_GATEWAY' });
    expect(down.fetch).toHaveBeenCalledTimes(2);
    const offline = clientWith(new TypeError('fetch failed'), new TypeError('fetch failed'));
    expect(await offline.client.publish(result)).toEqual({ failed: 'network' });
    expect(offline.fetch).toHaveBeenCalledTimes(2);
  });

  it('reads the worklist and fails when the API refuses it', async () => {
    const worklist = [entry('hemograma')];
    const { client, fetch } = clientWith(json(200, worklist), json(401, { code: 'INVALID_API_KEY' }));
    expect(await client.worklist('2026-11-19')).toEqual(worklist);
    expect((fetch.mock.calls[0]?.[0] as URL).href).toBe(
      'https://api.saudemais.test/api/integrations/lab/worklist?date=2026-11-19',
    );
    await expect(client.worklist('2026-11-19')).rejects.toThrow('status 401');
  });
});

describe('simulator configuration', () => {
  it('defaults to yesterday in São Paulo and to no amendments', () => {
    expect(parseSimulatorConfig([], ENV, new Date('2026-11-20T02:30:00.000Z'))).toEqual({
      apiUrl: ENV.LAB_API_URL,
      apiKey: API_KEY,
      date: '2026-11-18',
      amendChance: 0,
    });
    expect(parseSimulatorConfig(['--date=2026-11-10', '--amend-chance=0.1'], ENV, NOW)).toMatchObject({
      date: '2026-11-10',
      amendChance: 0.1,
    });
  });

  it('fails fast on missing or invalid settings', () => {
    expect(() => parseSimulatorConfig([], {}, NOW)).toThrow(/LAB_API_URL[\s\S]*LAB_API_KEY/);
    expect(() => parseSimulatorConfig([], { ...ENV, LAB_API_URL: 'ftp://lab', LAB_API_KEY: 'x' }, NOW)).toThrow(
      /LAB_API_URL: Set the API base URL[\s\S]*LAB_API_KEY: Use the key created/,
    );
    expect(() => parseSimulatorConfig(['--date=2026-13-01'], ENV, NOW)).toThrow(/date/);
    expect(() => parseSimulatorConfig(['--amend-chance=2'], ENV, NOW)).toThrow(/amendChance/);
    expect(() => parseSimulatorConfig(['--dry-run'], ENV, NOW)).toThrow(/dry-run/);
  });

  it('exits with an error from the command line without the settings', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/lab-simulator.ts'], {
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/Invalid lab simulator configuration.*LAB_API_URL/);
  });
});

describe('simulate', () => {
  const config: SimulatorConfig = { apiUrl: ENV.LAB_API_URL, apiKey: API_KEY, date: '2026-11-19', amendChance: 0 };
  const clock = { now: () => NOW };

  it('counts each outcome and logs only exam codes', async () => {
    const worklist = [
      entry('hemograma', 'EX-AAAAAA'),
      entry('densitometria', 'EX-BBBBBB'),
      entry('raio_x', 'EX-CCCCCC'),
    ];
    const publish = vi
      .fn<LabClient['publish']>()
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce({ failed: 409, code: 'RESULT_EXISTS' });
    const { logger, lines } = captureLogger();
    const client = { worklist: vi.fn(() => Promise.resolve(worklist)), publish };

    const tally = await simulate(config, { client, clock, logger });

    expect(tally).toEqual({ created: 1, unchanged: 0, amended: 0, skipped: 1, failed: 1 });
    expect(client.worklist).toHaveBeenCalledWith('2026-11-19');
    const logs = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.map(({ msg, ...rest }) => [msg, rest.examTypeCode ?? rest.code ?? rest.created])).toEqual([
      ['No result model for this exam type; skipped', 'densitometria'],
      ['Lab result was not published', 'RESULT_EXISTS'],
      ['Lab simulation finished', 1],
    ]);
    expect(logs[1]).toMatchObject({ examCode: 'EX-CCCCCC', failed: 409 });
  });
});

describe('simulator against the API', () => {
  let context: Clinic;
  let server: Server;
  let labConfig: SimulatorConfig;
  let patientId: string;

  beforeAll(async () => {
    context = await setupClinic();
    const admin = await createPatient(context, 'admin.simulador@email.com');
    patientId =
      (await context.db.execute<{ id: string }>(sql`select id from users where email = 'admin.simulador@email.com'`))
        .rows[0]?.id ?? '';
    await context.db.execute(sql`
      update user_roles set role = 'admin'
      where role = 'patient' and user_id = (select id from users where email = 'admin.simulador@email.com')
    `);
    const created = await request(context.app)
      .post('/api/admin/integration-clients')
      .set(as(admin))
      .send({ name: 'Simulador' })
      .expect(201);
    server = context.app.listen(0);
    labConfig = {
      apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      apiKey: (created.body as { apiKey: string }).apiKey,
      date: '2026-11-19',
      amendChance: 0,
    };
  }, 60_000);

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const run = (config: SimulatorConfig) =>
    simulate(config, { client: new LabClient(config), clock: context.clock, logger: captureLogger().logger });

  it('publishes yesterday’s worklist once and leaves nothing for a second run', async () => {
    const exams = await Promise.all(
      ['hemograma', 'ultrassom'].map(async (code, index) =>
        insertExam(context, {
          patientId,
          ...(await offerOf(context, 'Unidade Central', code)),
          startsAt: new Date(Date.parse('2026-11-19T12:00:00.000Z') + index * 3_600_000),
        }),
      ),
    );

    expect(await run(labConfig)).toEqual({ created: 2, unchanged: 0, amended: 0, skipped: 0, failed: 0 });
    expect(await run(labConfig)).toEqual({ created: 0, unchanged: 0, amended: 0, skipped: 0, failed: 0 });

    const stored = await context.db.execute<{
      public_code: string;
      status: string;
      payload: Record<string, unknown>;
    }>(sql`
      select b.public_code, b.status, v.payload from exam_result_versions v
      join exam_results r on r.id = v.result_id join bookings b on b.id = r.booking_id
      where b.id in (${exams[0]?.id}, ${exams[1]?.id}) order by b.starts_at
    `);
    expect(stored.rows.map((row) => [row.public_code, row.status, Object.keys(row.payload)])).toEqual([
      [exams[0]?.code, 'completed', ['items']],
      [exams[1]?.code, 'completed', ['report']],
    ]);
    const resent = simulationOf(
      { examCode: exams[0]?.code ?? '', examTypeCode: 'hemograma', startsAt: '2026-11-19T12:00:00.000Z' },
      START,
      0,
    );
    expect(await new LabClient(labConfig).publish(resent?.result as ResultInput)).toBe('unchanged');
  });

  it('amends a freshly published result when the chance hits', async () => {
    await insertExam(context, {
      patientId,
      ...(await offerOf(context, 'Unidade Central', 'raio_x')),
      startsAt: new Date('2026-11-18T15:00:00.000Z'),
    });

    expect(await run({ ...labConfig, date: '2026-11-18', amendChance: 1 })).toEqual({
      created: 1,
      unchanged: 0,
      amended: 1,
      skipped: 0,
      failed: 0,
    });
  });
});
