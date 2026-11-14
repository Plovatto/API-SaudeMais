import { runAfterCommit } from '../../database/pg-client.js';
import { AppError, unprocessableField } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { retryOnDeadlock } from '../../lib/pg-errors.js';
import { civilDate, CLINIC_TIME_ZONE, wallClockIn } from '../../lib/time.js';
import { slotDays } from '../../lib/time-slots.js';
import { forbidden, unauthenticated } from '../../middleware/auth.js';
import type { SlotContext } from '../doctors/doctors.repository.js';
import { doctorNotFound } from '../doctors/doctors.messages.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { ACTIVE_LIMIT, appointmentConflicts, appointmentNotFound, appointmentRules } from './appointments.messages.js';
import type { Appointment, BookAppointmentInput } from './appointments.model.js';
import type { AppointmentsRepository, Viewer } from './appointments.repository.js';

interface Patient {
  id: string;
  isProtected: boolean;
}

const exclusionConflicts = {
  bookings_doctor_no_overlap_excl: appointmentConflicts.slotTaken,
  bookings_patient_no_overlap_excl: appointmentConflicts.patientConflict,
};

const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);

function slotEnd(context: SlotContext, startsAt: Date, now: Date): Date {
  const date = civilDate(wallClockIn(CLINIC_TIME_ZONE, startsAt));
  const slot = slotDays({ ...context, from: date, to: date, now, timeZone: CLINIC_TIME_ZONE, busy: [] })
    .flatMap((day) => day.slots)
    .find((candidate) => candidate.startsAt === startsAt.toISOString());
  if (!slot) throw unprocessableField(appointmentRules.outsideAvailability);
  return new Date(slot.endsAt);
}

export class AppointmentsService {
  constructor(
    private readonly repository: AppointmentsRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  async book(patient: Patient, input: BookAppointmentInput): Promise<Appointment> {
    if (input.doctorId === patient.id) throw unprocessableField(appointmentRules.selfBooking);
    const result = await withConstraintConflicts(
      () => retryOnDeadlock(() => this.create(patient.id, input)),
      exclusionConflicts,
    );
    if (!result) throw unauthenticated();
    runAfterCommit(result.afterCommit);
    return this.detail(result.id, { userId: patient.id, roles: ['patient'] });
  }

  async detail(id: string, viewer: Viewer): Promise<Appointment> {
    if (!viewer.roles.includes('patient') && !viewer.roles.includes('doctor')) throw forbidden();
    const appointment = await this.repository.find(id, viewer, this.clock.now());
    if (!appointment) throw notFound(appointmentNotFound);
    return appointment;
  }

  private create(patientId: string, { doctorId, specialtyId, visitType, notes, ...input }: BookAppointmentInput) {
    return this.repository.book(patientId, async (tx, patient) => {
      const now = this.clock.now();
      if (!patient.isProtected && (await this.repository.activeFutureCount(tx, patientId, now)) >= ACTIVE_LIMIT) {
        throw unprocessableField(appointmentRules.activeLimit);
      }
      const context = await this.repository.lockDoctor(tx, {
        doctorId,
        specialtyId,
        includeProtected: patient.isProtected,
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
    });
  }
}
