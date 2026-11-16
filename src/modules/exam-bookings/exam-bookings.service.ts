import type { Transaction } from '../../database/pg-client.js';
import { AppError, conflictError, unprocessableField } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { CLINIC_TIME_ZONE, DAY, instantOfWallClock } from '../../lib/time.js';
import { slotAt, slotDays } from '../../lib/time-slots.js';
import { patientConflict } from '../bookings/bookings.messages.js';
import { exceptOwn, type LockedPatient } from '../bookings/bookings.repository.js';
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
import type { RescheduleInput } from '../appointments/appointments.model.js';
import {
  freeLanes,
  lanesInUse,
  type ExamBookingsRepository,
  type ExamSlotContext,
  type Offer,
} from './exam-bookings.repository.js';

const exclusionConflicts = {
  bookings_exam_lane_no_overlap_excl: examConflicts.noCapacity,
  bookings_patient_no_overlap_excl: patientConflict,
};

const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);

export class ExamBookingsService {
  constructor(
    private readonly repository: ExamBookingsRepository,
    private readonly bookings: BookingsService,
    private readonly clock: Clock,
  ) {}

  async availability(
    { unitId, examTypeId, rescheduling, ...period }: ExamAvailabilityQuery,
    patientId: string,
  ): Promise<ExamAvailability> {
    const now = this.clock.now();
    const context = await this.repository.availabilityContext(
      { unitId, examTypeId },
      {
        from: instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(period.from)),
        to: instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(period.to) + DAY),
      },
      exceptOwn(patientId, rescheduling),
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
    const id = await this.bookings.writeAsPatient(patientId, exclusionConflicts, (tx, patient) =>
      this.create(tx, patient, patientId, input),
    );
    return this.detail(id, patientId);
  }

  async detail(id: string, patientId: string): Promise<ExamBooking> {
    const exam = await this.repository.find(id, patientId, this.clock.now());
    if (!exam) throw notFound(examBookingNotFound);
    return exam;
  }

  async cancel(id: string, patientId: string, { startsAt }: CancelExamInput): Promise<ExamBooking> {
    if (!(await this.repository.offerOf(id, patientId))) throw notFound(examBookingNotFound);
    const canceller = { role: 'patient' as const, userId: patientId, reason: null };
    await this.bookings.commitSeen(
      (tx) => this.bookings.cancelSeen(tx, { id, startsAt: new Date(startsAt) }, canceller),
      examConflicts.invalidState,
    );
    return this.detail(id, patientId);
  }

  async reschedule(id: string, patientId: string, { startsAt, newStartsAt }: RescheduleInput): Promise<ExamBooking> {
    const offer = await this.repository.offerOf(id, patientId);
    if (!offer) throw notFound(examBookingNotFound);
    const target = new Date(newStartsAt);
    await this.bookings.rescheduleAsPatient(patientId, exclusionConflicts, async (tx) => {
      const now = this.clock.now();
      const context = await this.repository.lockOffer(tx, offer);
      if (!context) throw conflictError(examConflicts.notReschedulable);
      return this.bookings.moveSeen(
        tx,
        { id, patientId, startsAt: new Date(startsAt), newStartsAt: target, now },
        examConflicts.notReschedulable,
        ({ lane }) => this.seat(tx, context, offer, { startsAt: target, now }, { id, patientId, lane }),
      );
    });
    return this.detail(id, patientId);
  }

  private async create(
    tx: Transaction,
    patient: LockedPatient,
    patientId: string,
    { unitId, examTypeId, notes, ...input }: BookExamInput,
  ) {
    const now = this.clock.now();
    await this.bookings.ensureActiveLimit(tx, patientId, patient, now);
    const offer = { unitId, examTypeId };
    const context = await this.repository.lockOffer(tx, offer);
    if (!context) throw notFound(examOfferNotFound);
    const startsAt = new Date(input.startsAt);
    const seat = await this.seat(tx, context, offer, { startsAt, now });
    return this.repository.create(tx, {
      ...offer,
      ...seat,
      patientId,
      startsAt,
      notes: notes || null,
      now,
    });
  }

  private async seat(
    tx: Transaction,
    context: ExamSlotContext,
    offer: Offer,
    { startsAt, now }: { startsAt: Date; now: Date },
    current?: { id: string; patientId: string; lane: number | null },
  ) {
    const slot = slotAt({ ...context, now, timeZone: CLINIC_TIME_ZONE }, startsAt);
    if (!slot) throw unprocessableField(outsideExamAvailability);
    const endsAt = new Date(slot.endsAt);
    const except = current && exceptOwn(current.patientId, current.id);
    const lanes = await lanesInUse(tx, offer, { from: startsAt, to: endsAt }, except);
    const free = freeLanes(context.capacity, lanes, startsAt, endsAt);
    const lane = current?.lane && free.includes(current.lane) ? current.lane : free[0];
    if (lane === undefined) throw conflictError(examConflicts.noCapacity);
    return { endsAt, lane };
  }
}
