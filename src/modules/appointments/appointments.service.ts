import { runAfterCommit, type AfterCommit, type Transaction } from '../../database/pg-client.js';
import { AppError, conflictError, unprocessableField, type FieldConflict } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { CLINIC_TIME_ZONE } from '../../lib/time.js';
import { slotAt } from '../../lib/time-slots.js';
import { forbidden } from '../../middleware/auth.js';
import { patientConflict } from '../bookings/bookings.messages.js';
import type { BookingSide, LockedPatient, Outcome, SeenBooking } from '../bookings/bookings.repository.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { SlotContext } from '../doctors/doctors.repository.js';
import { doctorNotFound } from '../doctors/doctors.messages.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { appointmentConflicts, appointmentNotFound, appointmentRules } from './appointments.messages.js';
import type {
  Appointment,
  BookAppointmentInput,
  CancelAppointmentInput,
  CompleteAppointmentInput,
  RescheduleInput,
  SeenAppointmentInput,
} from './appointments.model.js';
import { insertMetrics, type AppointmentsRepository, type Viewer } from './appointments.repository.js';

const exclusionConflicts = {
  bookings_doctor_no_overlap_excl: appointmentConflicts.slotTaken,
  bookings_patient_no_overlap_excl: patientConflict,
};

const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);

function ensureParty({ roles }: Viewer): void {
  if (!roles.includes('patient') && !roles.includes('doctor')) throw forbidden();
}

const patientViewer = (userId: string): Viewer => ({ userId, roles: ['patient'] });

function slotEnd(context: SlotContext, startsAt: Date, now: Date): Date {
  const slot = slotAt({ ...context, now, timeZone: CLINIC_TIME_ZONE }, startsAt);
  if (!slot) throw unprocessableField(appointmentRules.outsideAvailability);
  return new Date(slot.endsAt);
}

export class AppointmentsService {
  constructor(
    private readonly repository: AppointmentsRepository,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsService,
    private readonly clock: Clock,
  ) {}

  async book(patientId: string, input: BookAppointmentInput): Promise<Appointment> {
    if (input.doctorId === patientId) throw unprocessableField(appointmentRules.selfBooking);
    const { id, afterCommit } = await this.bookings.writeAsPatient(patientId, exclusionConflicts, (tx, patient) =>
      this.create(tx, patient, patientId, input),
    );
    runAfterCommit(afterCommit);
    return this.detail(id, patientViewer(patientId));
  }

  async detail(id: string, viewer: Viewer): Promise<Appointment> {
    ensureParty(viewer);
    return this.find(id, viewer);
  }

  async cancel(id: string, viewer: Viewer, { startsAt, reason }: CancelAppointmentInput): Promise<Appointment> {
    ensureParty(viewer);
    return this.change(id, viewer, appointmentConflicts.invalidState, (role) => {
      if (role === 'doctor' && !reason) throw unprocessableField(appointmentRules.reasonRequired);
      const canceller = { role, userId: viewer.userId, reason: reason || null };
      return (tx) => this.bookings.cancelSeen(tx, { id, startsAt: new Date(startsAt) }, canceller);
    });
  }

  confirm(id: string, doctorId: string, input: SeenAppointmentInput): Promise<Appointment> {
    return this.changeAsDoctor(id, doctorId, input, appointmentConflicts.notConfirmable, (tx, seen) =>
      this.bookings.confirmSeen(tx, seen, doctorId),
    );
  }

  record(
    id: string,
    doctorId: string,
    outcome: Outcome,
    { metrics, ...input }: CompleteAppointmentInput,
  ): Promise<Appointment> {
    return this.changeAsDoctor(id, doctorId, input, appointmentConflicts.notRecordable, async (tx, seen) => {
      const now = this.clock.now();
      const afterCommit = await this.bookings.recordSeen(tx, seen, doctorId, outcome, now);
      if (afterCommit && metrics) await insertMetrics(tx, id, metrics, now);
      return afterCommit;
    });
  }

  private changeAsDoctor(
    id: string,
    doctorId: string,
    { startsAt }: SeenAppointmentInput,
    conflict: FieldConflict,
    work: (tx: Transaction, seen: SeenBooking) => Promise<AfterCommit | undefined>,
  ): Promise<Appointment> {
    const seen = { id, startsAt: new Date(startsAt) };
    return this.change(id, { userId: doctorId, roles: ['doctor'] }, conflict, () => (tx) => work(tx, seen));
  }

  async reschedule(id: string, patientId: string, { startsAt, newStartsAt }: RescheduleInput): Promise<Appointment> {
    const viewer = patientViewer(patientId);
    const party = await this.repository.partyOf(id, viewer);
    if (!party) throw notFound(appointmentNotFound);
    const target = new Date(newStartsAt);
    const afterCommit = await this.bookings.rescheduleAsPatient(patientId, exclusionConflicts, async (tx, patient) => {
      const now = this.clock.now();
      const context = await this.repository.lockDoctor(tx, { ...party, includeProtected: patient.isProtected, now });
      if (!context) throw conflictError(appointmentConflicts.notReschedulable);
      const moved = await this.bookings.moveSeen(
        tx,
        { id, patientId, startsAt: new Date(startsAt), newStartsAt: target, now },
        appointmentConflicts.notReschedulable,
        () => ({ endsAt: slotEnd(context, target, now), status: 'pending' }),
      );
      return this.notifications.notify(tx, [
        {
          userId: party.doctorId,
          audienceRole: 'doctor',
          type: 'appointment_rescheduled',
          bookingId: id,
          params: { startsAt: moved.startsAt.toISOString(), fromStartsAt: moved.fromStartsAt.toISOString() },
        },
      ]);
    });
    runAfterCommit(afterCommit);
    return this.find(id, viewer);
  }

  private async change(
    id: string,
    viewer: Viewer,
    conflict: FieldConflict,
    prepare: (role: BookingSide) => (tx: Transaction) => Promise<AfterCommit | undefined>,
  ): Promise<Appointment> {
    const party = await this.repository.partyOf(id, viewer);
    if (!party) throw notFound(appointmentNotFound);
    await this.bookings.commitSeen(prepare(party.side), conflict);
    return this.find(id, viewer);
  }

  private async find(id: string, viewer: Viewer): Promise<Appointment> {
    const appointment = await this.repository.find(id, viewer, this.clock.now());
    if (!appointment) throw notFound(appointmentNotFound);
    return appointment;
  }

  private async create(
    tx: Transaction,
    patient: LockedPatient,
    patientId: string,
    { doctorId, specialtyId, visitType, notes, ...input }: BookAppointmentInput,
  ) {
    const now = this.clock.now();
    await this.bookings.ensureActiveLimit(tx, patientId, patient, now);
    const context = await this.repository.lockDoctor(tx, {
      doctorId,
      specialtyId,
      includeProtected: patient.isProtected,
      now,
    });
    if (!context) throw notFound(doctorNotFound);
    if (context.specialtyId !== specialtyId) throw unprocessableField(appointmentRules.specialtyMismatch);
    const startsAt = new Date(input.startsAt);
    const endsAt = slotEnd(context, startsAt, now);
    const id = await this.repository.create(tx, {
      patientId,
      doctorId,
      visitType,
      startsAt,
      endsAt,
      notes: notes || null,
      now,
    });
    const afterCommit = await this.notifications.notify(tx, [
      {
        userId: doctorId,
        audienceRole: 'doctor',
        type: 'appointment_requested',
        bookingId: id,
        params: { startsAt: startsAt.toISOString() },
      },
    ]);
    return { id, afterCommit };
  }
}
