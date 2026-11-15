import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import { bookings, effectiveStatus } from '../../database/schema/bookings.js';
import { examTypes, unitExamOffers, units } from '../../database/schema/catalog.js';
import type { SlotRequest } from '../../lib/time-slots.js';
import {
  asPatient,
  cancellationColumns,
  eventsOf,
  placeColumns,
  recordCreated,
  viewOf,
  type LockedPatient,
} from '../bookings/bookings.repository.js';
import { hoursOf } from '../doctor-schedule/doctor-schedule.repository.js';
import { slotPolicy } from '../doctors/doctors.repository.js';
import { newPublicCode } from './exam-bookings.code.js';
import type { ExamBooking } from './exam-bookings.model.js';

export interface Offer {
  unitId: string;
  examTypeId: string;
}

export interface LaneUse {
  startsAt: Date;
  endsAt: Date;
  lane: number;
}

export type ExamSlotContext = Pick<
  SlotRequest,
  'ranges' | 'unitHours' | 'durationMin' | 'minLeadMinutes' | 'bookingHorizonDays'
> & { capacity: number };

const CODE_ATTEMPTS = 5;

interface Period {
  from: Date;
  to: Date;
}

interface NewExam extends Offer {
  patientId: string;
  lane: number;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  now: Date;
}

interface Sizing {
  capacity: number;
  durationMin: number;
}

async function slotFrame(db: Pick<Database, 'select'>, unitId: string, sizing: Sizing): Promise<ExamSlotContext> {
  const unitHours = await hoursOf(db, unitId);
  const ranges = unitHours.map(({ weekday, openMin, closeMin }) => ({ weekday, startMin: openMin, endMin: closeMin }));
  return { ...sizing, ranges, unitHours, ...(await slotPolicy(db)) };
}

const examWith = (id: string, patientId: string) =>
  and(eq(bookings.id, id), eq(bookings.kind, 'exam'), eq(bookings.patientId, patientId));

export class ExamBookingsRepository {
  constructor(private readonly db: Database) {}

  availabilityContext(offer: Offer, period: Period): Promise<(ExamSlotContext & { lanes: LaneUse[] }) | undefined> {
    return this.db.transaction(async (tx) => {
      const [sizing] = await tx
        .select({ capacity: unitExamOffers.capacityPerSlot, durationMin: examTypes.durationMin })
        .from(unitExamOffers)
        .innerJoin(units, eq(units.id, unitExamOffers.unitId))
        .innerJoin(examTypes, eq(examTypes.id, unitExamOffers.examTypeId))
        .where(
          and(
            eq(unitExamOffers.unitId, offer.unitId),
            eq(unitExamOffers.examTypeId, offer.examTypeId),
            eq(unitExamOffers.isActive, true),
            eq(units.isActive, true),
            eq(examTypes.isActive, true),
          ),
        );
      if (!sizing) return undefined;
      return { ...(await slotFrame(tx, offer.unitId, sizing)), lanes: await this.lanesInUse(tx, offer, period) };
    }, readSnapshot);
  }

  book<T>(patientId: string, work: (tx: Transaction, patient: LockedPatient) => Promise<T>) {
    return asPatient(this.db, patientId, work);
  }

  async lockOffer(tx: Transaction, { unitId, examTypeId }: Offer): Promise<ExamSlotContext | undefined> {
    const [unit] = await tx.select({ isActive: units.isActive }).from(units).where(eq(units.id, unitId)).for('share');
    const [examType] = await tx
      .select({ isActive: examTypes.isActive, durationMin: examTypes.durationMin })
      .from(examTypes)
      .where(eq(examTypes.id, examTypeId))
      .for('share');
    const [offer] = await tx
      .select({ isActive: unitExamOffers.isActive, capacity: unitExamOffers.capacityPerSlot })
      .from(unitExamOffers)
      .where(and(eq(unitExamOffers.unitId, unitId), eq(unitExamOffers.examTypeId, examTypeId)))
      .for('no key update');
    if (!unit?.isActive || !examType?.isActive || !offer?.isActive) return undefined;
    return slotFrame(tx, unitId, { capacity: offer.capacity, durationMin: examType.durationMin });
  }

  lanesInUse(tx: Transaction, { unitId, examTypeId }: Offer, { from, to }: Period): Promise<LaneUse[]> {
    return tx
      .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt, lane: sql<number>`${bookings.lane}` })
      .from(bookings)
      .where(
        and(
          eq(bookings.unitId, unitId),
          eq(bookings.examTypeId, examTypeId),
          eq(bookings.kind, 'exam'),
          eq(bookings.status, 'confirmed'),
          lt(bookings.startsAt, to),
          gt(bookings.endsAt, from),
        ),
      );
  }

  async create(tx: Transaction, exam: NewExam, attempt = 1): Promise<string> {
    const { patientId, now, ...fields } = exam;
    const [row] = await tx
      .insert(bookings)
      .values({ ...fields, kind: 'exam', status: 'confirmed', patientId, publicCode: newPublicCode(), createdAt: now })
      .onConflictDoNothing({ target: bookings.publicCode })
      .returning({ id: bookings.id });
    if (!row && attempt >= CODE_ATTEMPTS) throw new Error(`No free public code after ${CODE_ATTEMPTS} attempts`);
    if (!row) return this.create(tx, exam, attempt + 1);
    await recordCreated(tx, { bookingId: row.id, patientId, status: 'confirmed', now });
    return row.id;
  }

  async owns(id: string, patientId: string): Promise<boolean> {
    return (await this.db.$count(bookings, examWith(id, patientId))) > 0;
  }

  find(id: string, patientId: string, now: Date): Promise<ExamBooking | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: bookings.id,
          status: effectiveStatus(now),
          publicCode: sql<string>`${bookings.publicCode}`,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          notes: bookings.notes,
          examType: {
            id: examTypes.id,
            name: examTypes.name,
            kind: examTypes.kind,
            preparationNotes: examTypes.preparationNotes,
          },
          unit: placeColumns.unit,
          cancellation: cancellationColumns,
          createdAt: bookings.createdAt,
        })
        .from(bookings)
        .innerJoin(units, eq(units.id, bookings.unitId))
        .innerJoin(examTypes, eq(examTypes.id, bookings.examTypeId))
        .where(examWith(id, patientId));
      if (!row) return undefined;
      return { ...viewOf(row), createdAt: row.createdAt.toISOString(), events: await eventsOf(tx, id) };
    }, readSnapshot);
  }
}
