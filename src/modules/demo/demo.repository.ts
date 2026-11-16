import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { auditLogs } from '../../database/schema/audit-logs.js';
import { bookingEvents, bookings } from '../../database/schema/bookings.js';
import { examTypes, specialties, unitExamOffers, unitHours, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { examResults } from '../../database/schema/exam-results.js';
import { healthMetrics } from '../../database/schema/health-metrics.js';
import { integrationClients } from '../../database/schema/integration-clients.js';
import { notifications } from '../../database/schema/notifications.js';
import { userRoles, users } from '../../database/schema/users.js';
import { MAINTENANCE_LOCK } from '../../jobs/maintenance.js';
import type { HealthMetricsInput } from '../appointments/appointments.model.js';
import { insertMetrics } from '../appointments/appointments.repository.js';
import { freeLanes, lanesInUse } from '../exam-bookings/exam-bookings.repository.js';
import type { Recipient } from '../notifications/notifications.service.js';
import type { DemoResultSeed, ExamTypeSeed, SpecialtySeed, UnitSeed } from './demo.data.js';

export interface SpecialtyRef {
  id: string;
  council: string;
  isActive: boolean;
}

export interface UnitRef {
  id: string;
  isActive: boolean;
}

export interface DoctorProfileSeed {
  userId: string;
  specialty: SpecialtyRef;
  unitId: string;
  registryNumber: string;
  registryUf: string;
  now: Date;
}

export interface DemoBooking {
  booking: Omit<typeof bookings.$inferInsert, 'examTypeId' | 'lane'>;
  exam?: { examTypeId: string; capacity: number };
  events: Omit<typeof bookingEvents.$inferInsert, 'bookingId'>[];
  metrics?: HealthMetricsInput | undefined;
  results: readonly DemoResultSeed[];
}

export interface RestoredDemo {
  deleted: number;
  created: number;
}

interface Restoration {
  restored: RestoredDemo;
  recipients: Recipient[];
  examCodes: string[];
}

const RESTORE_ACTION = 'demo.restored';

export class DemoRepository {
  constructor(private readonly db: Database) {}

  async ensureSpecialty(seed: SpecialtySeed): Promise<SpecialtyRef | undefined> {
    await this.db.insert(specialties).values(seed).onConflictDoNothing();
    const [row] = await this.db
      .select({ id: specialties.id, council: specialties.council, isActive: specialties.isActive })
      .from(specialties)
      .where(eq(specialties.name, seed.name));
    return row;
  }

  async ensureUnit({ hours, ...seed }: UnitSeed): Promise<UnitRef | undefined> {
    const [created] = await this.db.insert(units).values(seed).onConflictDoNothing().returning({ id: units.id });
    if (created) {
      await this.db.insert(unitHours).values(hours.map((hour) => ({ ...hour, unitId: created.id })));
      return { id: created.id, isActive: true };
    }
    const [row] = await this.db
      .select({ id: units.id, isActive: units.isActive })
      .from(units)
      .where(eq(units.name, seed.name));
    return row;
  }

  async ensureExamType(seed: ExamTypeSeed): Promise<string | undefined> {
    await this.db.insert(examTypes).values(seed).onConflictDoNothing();
    const [row] = await this.db.select({ id: examTypes.id }).from(examTypes).where(eq(examTypes.code, seed.code));
    return row?.id;
  }

  async ensureOffer(unitId: string, examTypeId: string, capacityPerSlot: number): Promise<void> {
    await this.db.insert(unitExamOffers).values({ unitId, examTypeId, capacityPerSlot }).onConflictDoNothing();
  }

  async userIdByEmail(email: string): Promise<string | undefined> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row?.id;
  }

  async integrationClient(name: string) {
    const [row] = await this.db
      .select({
        id: integrationClients.id,
        revokedAt: integrationClients.revokedAt,
        createdBy: integrationClients.createdBy,
      })
      .from(integrationClients)
      .where(eq(integrationClients.name, name));
    return row;
  }

  async hasDoctorProfile(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: doctorProfiles.userId })
      .from(doctorProfiles)
      .where(eq(doctorProfiles.userId, userId));
    return Boolean(row);
  }

  grantDoctorProfile({ userId, specialty, unitId, registryNumber, registryUf, now }: DoctorProfileSeed): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(doctorProfiles)
        .values({ userId, specialtyId: specialty.id, council: specialty.council, unitId, registryNumber, registryUf })
        .onConflictDoNothing({ target: doctorProfiles.userId });
      await tx.insert(userRoles).values({ userId, role: 'doctor', grantedAt: now }).onConflictDoNothing();
    });
  }

  async demoDoctor(email: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        specialtyId: doctorProfiles.specialtyId,
        unitId: doctorProfiles.unitId,
        durationMin: specialties.appointmentDurationMin,
      })
      .from(users)
      .innerJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
      .innerJoin(specialties, eq(specialties.id, doctorProfiles.specialtyId))
      .where(eq(users.email, email));
    return row;
  }

  async examOffer(unitId: string, code: string) {
    const [row] = await this.db
      .select({
        examTypeId: examTypes.id,
        durationMin: examTypes.durationMin,
        capacity: unitExamOffers.capacityPerSlot,
      })
      .from(unitExamOffers)
      .innerJoin(examTypes, eq(examTypes.id, unitExamOffers.examTypeId))
      .where(and(eq(unitExamOffers.unitId, unitId), eq(examTypes.code, code)));
    return row;
  }

  restoreBookings(since: Date, now: Date, demoBookings: DemoBooking[]): Promise<Restoration | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${MAINTENANCE_LOCK}, 1)`);
      if (
        (await tx.$count(auditLogs, and(eq(auditLogs.action, RESTORE_ACTION), gte(auditLogs.createdAt, since)))) > 0
      ) {
        return undefined;
      }
      const protectedIds = tx.select({ id: users.id }).from(users).where(eq(users.isProtected, true));
      const demoScope = or(inArray(bookings.patientId, protectedIds), inArray(bookings.doctorId, protectedIds));
      const demoBookingIds = tx.select({ id: bookings.id }).from(bookings).where(demoScope);
      await tx.delete(examResults).where(inArray(examResults.bookingId, demoBookingIds));
      await tx.delete(healthMetrics).where(inArray(healthMetrics.bookingId, demoBookingIds));
      const recipients = await tx
        .delete(notifications)
        .where(inArray(notifications.bookingId, demoBookingIds))
        .returning({ userId: notifications.userId, audienceRole: notifications.audienceRole });
      const deleted = await tx.delete(bookings).where(demoScope).returning({ id: bookings.id });
      let created = 0;
      const examCodes: string[] = [];
      for (const { booking, exam, events, metrics } of demoBookings) {
        const { startsAt, endsAt } = booking;
        const offer = exam && { unitId: booking.unitId, examTypeId: exam.examTypeId };
        const [lane] = offer
          ? freeLanes(exam.capacity, await lanesInUse(tx, offer, { from: startsAt, to: endsAt }), startsAt, endsAt)
          : [];
        if (offer && lane === undefined) continue;
        const [inserted] = await tx
          .insert(bookings)
          .values({ ...booking, ...offer, lane })
          .onConflictDoNothing()
          .returning({ id: bookings.id });
        if (!inserted) continue;
        if (booking.publicCode) examCodes.push(booking.publicCode);
        created += 1;
        await tx.insert(bookingEvents).values(events.map((event) => ({ ...event, bookingId: inserted.id })));
        if (metrics) await insertMetrics(tx, inserted.id, metrics, endsAt);
      }
      const restored = { deleted: deleted.length, created };
      await tx
        .insert(auditLogs)
        .values({ actorType: 'system', action: RESTORE_ACTION, metadata: restored, createdAt: now });
      return { restored, recipients, examCodes };
    });
  }
}
