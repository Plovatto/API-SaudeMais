import { sql } from 'drizzle-orm';
import { bookings } from '@/database/schema/bookings.js';
import { MINUTE } from '@/lib/time.js';
import { newPublicCode } from '@/modules/exam-bookings/exam-bookings.code.js';
import type { Clinic } from './doctors.js';

export interface Offer {
  unitId: string;
  examTypeId: string;
}

type ExamValues = Offer & Partial<typeof bookings.$inferInsert> & { patientId: string; startsAt: Date };

export async function offerOf({ db }: Pick<Clinic, 'db'>, unit: string, code: string): Promise<Offer> {
  const rows = await db.execute<{ unit_id: string; exam_type_id: string }>(sql`
    select o.unit_id, o.exam_type_id from unit_exam_offers o
    join units u on u.id = o.unit_id join exam_types e on e.id = o.exam_type_id
    where u.name = ${unit} and e.code = ${code}
  `);
  const row = rows.rows[0];
  if (!row) throw new Error(`${unit} does not offer ${code}`);
  return { unitId: row.unit_id, examTypeId: row.exam_type_id };
}

export async function insertExam({ db }: Pick<Clinic, 'db'>, values: ExamValues) {
  const [row] = await db
    .insert(bookings)
    .values({
      kind: 'exam',
      publicCode: newPublicCode(),
      lane: 1,
      endsAt: new Date(values.startsAt.getTime() + 10 * MINUTE),
      status: 'confirmed',
      ...values,
    })
    .returning({ id: bookings.id, code: bookings.publicCode });
  if (!row?.code) throw new Error('The exam was not inserted');
  return { id: row.id, code: row.code };
}
