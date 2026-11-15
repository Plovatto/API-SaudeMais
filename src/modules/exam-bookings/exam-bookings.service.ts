import { AppError, conflictError, unprocessableField } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { retryOnDeadlock } from '../../lib/pg-errors.js';
import { CLINIC_TIME_ZONE, DAY, instantOfWallClock } from '../../lib/time.js';
import { slotAt, slotDays } from '../../lib/time-slots.js';
import { unauthenticated } from '../../middleware/auth.js';
import { patientConflict } from '../bookings/bookings.messages.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import {
  examBookingNotFound,
  examConflicts,
  examOfferNotFound,
  outsideExamAvailability,
} from './exam-bookings.messages.js';
import type {
  BookExamInput,
  CancelExamInput,
  ExamAvailability,
  ExamAvailabilityQuery,
  ExamBooking,
} from './exam-bookings.model.js';
import type { ExamBookingsRepository, LaneUse } from './exam-bookings.repository.js';

const exclusionConflicts = {
  bookings_exam_lane_no_overlap_excl: examConflicts.noCapacity,
  bookings_patient_no_overlap_excl: patientConflict,
};

const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);

function freeLanes(capacity: number, lanes: LaneUse[], startsAt: Date, endsAt: Date): number[] {
  const taken = new Set(lanes.filter((use) => use.startsAt < endsAt && startsAt < use.endsAt).map((use) => use.lane));
  return Array.from({ length: capacity }, (_, index) => index + 1).filter((lane) => !taken.has(lane));
}

export class ExamBookingsService {
  constructor(
    private readonly repository: ExamBookingsRepository,
    private readonly bookings: BookingsService,
    private readonly clock: Clock,
  ) {}

  async availability({ unitId, examTypeId, ...period }: ExamAvailabilityQuery): Promise<ExamAvailability> {
    const now = this.clock.now();
    const context = await this.repository.availabilityContext(
      { unitId, examTypeId },
      {
        from: instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(period.from)),
        to: instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(period.to) + DAY),
      },
    );
    if (!context) throw notFound(examOfferNotFound);
    const days = slotDays({ ...context, ...period, now, timeZone: CLINIC_TIME_ZONE, busy: [] }).map(
      ({ date, slots }) => ({
        date,
        slots: slots
          .map((slot) => ({
            ...slot,
            remaining: freeLanes(context.capacity, context.lanes, new Date(slot.startsAt), new Date(slot.endsAt))
              .length,
          }))
          .filter((slot) => slot.remaining > 0),
      }),
    );
    return { days: days.filter((day) => day.slots.length > 0) };
  }

  async book(patientId: string, input: BookExamInput): Promise<ExamBooking> {
    const id = await withConstraintConflicts(
      () => retryOnDeadlock(() => this.create(patientId, input)),
      exclusionConflicts,
    );
    if (!id) throw unauthenticated();
    return this.detail(id, patientId);
  }

  async detail(id: string, patientId: string): Promise<ExamBooking> {
    const exam = await this.repository.find(id, patientId, this.clock.now());
    if (!exam) throw notFound(examBookingNotFound);
    return exam;
  }

  async cancel(id: string, patientId: string, { startsAt }: CancelExamInput): Promise<ExamBooking> {
    if (!(await this.repository.owns(id, patientId))) throw notFound(examBookingNotFound);
    const canceller = { role: 'patient' as const, userId: patientId, reason: null };
    await this.bookings.commitSeen(
      (tx) => this.bookings.cancelSeen(tx, { id, startsAt: new Date(startsAt) }, canceller),
      examConflicts.invalidState,
    );
    return this.detail(id, patientId);
  }

  private create(patientId: string, { unitId, examTypeId, notes, ...input }: BookExamInput) {
    return this.repository.book(patientId, async (tx, patient) => {
      await this.bookings.ensureActiveLimit(tx, patientId, patient);
      const now = this.clock.now();
      const context = await this.repository.lockOffer(tx, { unitId, examTypeId });
      if (!context) throw notFound(examOfferNotFound);
      const startsAt = new Date(input.startsAt);
      const slot = slotAt({ ...context, now, timeZone: CLINIC_TIME_ZONE }, startsAt);
      if (!slot) throw unprocessableField(outsideExamAvailability);
      const endsAt = new Date(slot.endsAt);
      const lanes = await this.repository.lanesInUse(tx, { unitId, examTypeId }, { from: startsAt, to: endsAt });
      const [lane] = freeLanes(context.capacity, lanes, startsAt, endsAt);
      if (lane === undefined) throw conflictError(examConflicts.noCapacity);
      return this.repository.create(tx, {
        unitId,
        examTypeId,
        patientId,
        lane,
        startsAt,
        endsAt,
        notes: notes || null,
        now,
      });
    });
  }
}
