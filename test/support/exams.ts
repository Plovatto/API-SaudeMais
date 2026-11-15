import { sql } from 'drizzle-orm';
import type { Clinic } from './doctors.js';

export interface Offer {
  unitId: string;
  examTypeId: string;
}

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
