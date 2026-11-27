import { sql } from 'drizzle-orm';
import type { Database } from '@/database/pg-client.js';

export const REPORT_PATIENT = 'ana.silva@email.com';

export interface Cancellation {
  role?: 'patient' | 'doctor' | 'admin' | 'system';
  late?: boolean;
}

interface Extras {
  createdAt?: string | undefined;
  reschedules?: number | undefined;
}

const cancellationColumns = (status: string, { role, late = false }: Cancellation) => sql`
  ${status}::text,
  case when ${status}::text = 'cancelled' then now() end,
  ${role ?? null}::text,
  case when ${role ?? null}::text <> 'system' then u.id end,
  case when ${role ?? null}::text = 'doctor' then 'Motivo do médico' end,
  ${late}
`;

const extraColumns = ({ createdAt, reschedules = 0 }: Extras) => sql`
  coalesce(${createdAt ?? null}::timestamptz, now()), ${reschedules}::smallint
`;

export function insertAppointment(
  db: Database,
  startsAt: string,
  status: string,
  {
    doctor = 'Dr. Carlos Mendes',
    email = REPORT_PATIENT,
    createdAt,
    reschedules,
    ...cancellation
  }: Cancellation & Extras & { doctor?: string; email?: string } = {},
) {
  return db.execute(sql`
    insert into bookings (kind, patient_id, unit_id, doctor_id, specialty_id, visit_type, starts_at, ends_at,
      status, cancelled_at, cancelled_by_role, cancelled_by, cancel_reason, late_cancellation, created_at,
      reschedule_count)
    select 'appointment', u.id, p.unit_id, p.user_id, p.specialty_id, 'routine', ${startsAt}::timestamptz,
      ${startsAt}::timestamptz + interval '30 minutes', ${cancellationColumns(status, cancellation)},
      ${extraColumns({ createdAt, reschedules })}
    from users u, doctor_profiles p join users d on d.id = p.user_id
    where u.email = ${email} and d.full_name = ${doctor}
  `);
}

export function insertExam(
  db: Database,
  code: string,
  publicCode: string,
  startsAt: string,
  status: string,
  { createdAt, reschedules, ...cancellation }: Cancellation & Extras = {},
) {
  return db.execute(sql`
    insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at,
      status, cancelled_at, cancelled_by_role, cancelled_by, cancel_reason, late_cancellation, created_at,
      reschedule_count)
    select 'exam', u.id, o.unit_id, o.exam_type_id, ${publicCode}, 1, ${startsAt}::timestamptz,
      ${startsAt}::timestamptz + interval '20 minutes', ${cancellationColumns(status, cancellation)},
      ${extraColumns({ createdAt, reschedules })}
    from users u, unit_exam_offers o join exam_types e on e.id = o.exam_type_id
    where u.email = ${REPORT_PATIENT} and e.code = ${code}
    limit 1
  `);
}
