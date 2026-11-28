import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { anyText, as, buildUsersApp, login } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

const BOUNDS = [
  ['reminderLeadHours', 'reminder_lead_hours', 1, 168],
  ['autoCompleteAfterHours', 'auto_complete_after_hours', 1, 720],
  ['notificationRetentionDays', 'notification_retention_days', 7, 730],
  ['auditRetentionDays', 'audit_retention_days', 30, 1825],
] as const;

type Context = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN);
  const admin = ((await login(context.app, ADMIN).expect(200)).body as { token: string }).token;
  return { ...context, admin };
}

let context: Context;
let policy: Record<string, unknown>;

beforeAll(async () => {
  context = await setup();
  const { updatedAt: _updatedAt, ...current } = (
    await request(context.app).get('/api/admin/policy').set(as(context.admin)).expect(200)
  ).body as { updatedAt: string };
  policy = current;
}, 60_000);

const save = (body: object) => request(context.app).put('/api/admin/policy').set(as(context.admin)).send(body);

describe('policy operations', () => {
  it('exposes the planned defaults', () => {
    expect(policy).toMatchObject({
      reminderLeadHours: 24,
      autoCompleteAfterHours: 72,
      notificationRetentionDays: 90,
      auditRetentionDays: 180,
    });
  });

  it('saves the values and records them in the audit log', async () => {
    const values = {
      reminderLeadHours: 48,
      autoCompleteAfterHours: 24,
      notificationRetentionDays: 30,
      auditRetentionDays: 365,
    };

    const response = await save({ ...policy, ...values });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ...values, updatedAt: anyText });
    const audit = await context.db.execute<{ metadata: Record<string, unknown> }>(
      sql`select metadata from audit_logs where action = 'policy.updated' order by created_at desc limit 1`,
    );
    expect(audit.rows[0]?.metadata).toMatchObject(values);
  });

  it('keeps a stored value that a client leaves out', async () => {
    expect((await save({ ...policy, reminderLeadHours: 12 })).status).toBe(200);
    const { reminderLeadHours: _left, ...incomplete } = policy;

    const response = await save(incomplete);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ reminderLeadHours: 12 });
  });

  it.each(BOUNDS.flatMap(([field, , min, max]) => [min - 1, max + 1, 2.5].map((value) => [field, value] as const)))(
    'refuses %s = %s with VALIDATION_ERROR',
    async (field, value) => {
      const response = await save({ ...policy, [field]: value });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { [field]: anyText } });
    },
  );

  it.each(BOUNDS)('accepts %s at both bounds', async (field, _column, min, max) => {
    for (const value of [min, max]) {
      const response = await save({ ...policy, [field]: value });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ [field]: value });
    }
  });

  it.each(BOUNDS.flatMap(([, column, min, max]) => [min - 1, max + 1].map((value) => [column, value] as const)))(
    'keeps %s = %s out of the database too',
    async (column, value) => {
      await expect(
        context.db.execute(sql`update settings set ${sql.identifier(column)} = ${value}`),
      ).rejects.toMatchObject({ cause: { constraint: `settings_${column}_check` } });
    },
  );
});
