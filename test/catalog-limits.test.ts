import { beforeAll, describe, expect, it } from 'vitest';
import { users } from '@/database/schema/users.js';
import { CatalogRepository } from '@/modules/catalog/catalog.repository.js';
import { CatalogService } from '@/modules/catalog/catalog.service.js';
import { buildUsersApp } from './support/users.js';

const LIMIT = 2;
const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

type Context = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const { db, clock, modules } = await buildUsersApp();
  await modules.users.bootstrap(ADMIN);
  const [admin] = await db.select({ id: users.id }).from(users);
  if (!admin) throw new Error('Admin was not created');
  const service = new CatalogService(new CatalogRepository(db, clock, LIMIT));
  return { service, actor: { actorId: admin.id, ip: null } };
}

let context: Context;

beforeAll(async () => {
  context = await setup();
}, 60_000);

const unitInput = (name: string, hours: { weekday: number; openMin: number; closeMin: number }[] = []) => ({
  name,
  address: 'Rua das Flores, 123 - Centro',
  phone: '+551133334444',
  hours,
});

const specialtyInput = (name: string) => ({ name, council: 'CRM', appointmentDurationMin: 30 });

const examTypeInput = (code: string) => ({
  code,
  name: `Exame ${code}`,
  kind: 'lab' as const,
  durationMin: 15,
  preparationNotes: null,
});

const limitReached = { status: 422, code: 'CATALOG_LIMIT_REACHED' };

const catalogs = [
  {
    entity: 'specialty',
    create: (suffix: string) => context.service.createSpecialty(specialtyInput(`Limite ${suffix}`), context.actor),
    update: (id: string, changes: { isActive: boolean }) => context.service.updateSpecialty(id, changes, context.actor),
  },
  {
    entity: 'unit',
    create: (suffix: string) => context.service.createUnit(unitInput(`Limite ${suffix}`), context.actor),
    update: (id: string, changes: { isActive: boolean }) => context.service.updateUnit(id, changes, context.actor),
  },
  {
    entity: 'exam type',
    create: (suffix: string) =>
      context.service.createExamType(examTypeInput(`lim_${suffix.toLowerCase()}`), context.actor),
    update: (id: string, changes: { isActive: boolean }) => context.service.updateExamType(id, changes, context.actor),
  },
];

describe.each(catalogs)('active $entity limit', ({ create, update }) => {
  it('refuses to create past the limit and frees a slot when one is deactivated', async () => {
    const first = await create('A');
    await create('B');
    await expect(create('C')).rejects.toMatchObject(limitReached);

    await update(first.id, { isActive: false });
    const replacement = await create('D');
    expect(replacement.isActive).toBe(true);
    await expect(create('E')).rejects.toMatchObject(limitReached);

    await expect(update(first.id, { isActive: true })).rejects.toMatchObject(limitReached);
    await expect(update(replacement.id, { isActive: true })).resolves.toMatchObject({ isActive: true });
  });
});

describe('unit hours', () => {
  it('attaches each unit its own hours, ordered by weekday', async () => {
    const { db, clock, modules } = await buildUsersApp();
    await modules.users.bootstrap(ADMIN);
    const [admin] = await db.select({ id: users.id }).from(users);
    if (!admin) throw new Error('Admin was not created');
    const actor = { actorId: admin.id, ip: null };
    const service = new CatalogService(new CatalogRepository(db, clock));
    const morning = { weekday: 1, openMin: 480, closeMin: 720 };
    const sunday = { weekday: 0, openMin: 540, closeMin: 600 };
    const evening = { weekday: 5, openMin: 1020, closeMin: 1200 };
    await service.createUnit(unitInput('Centro', [morning, sunday]), actor);
    await service.createUnit(unitInput('Fechada'), actor);
    await service.createUnit(unitInput('Norte', [evening]), actor);

    const units = await service.activeUnits(undefined);

    expect(units.map(({ name, hours }) => [name, hours])).toEqual([
      ['Centro', [sunday, morning]],
      ['Fechada', []],
      ['Norte', [evening]],
    ]);
  });
});
