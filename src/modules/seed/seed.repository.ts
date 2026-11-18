import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { bookingEvents, bookings } from '../../database/schema/bookings.js';
import { examTypes, specialties, unitExamOffers, unitHours, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { doctorTimeOff } from '../../database/schema/doctor-schedule.js';
import { integrationClients } from '../../database/schema/integration-clients.js';
import { userRoles, users } from '../../database/schema/users.js';
import type { HealthMetricsInput } from '../appointments/appointments.model.js';
import { insertMetrics } from '../appointments/appointments.repository.js';
import { freeLanes, lanesInUse } from '../exam-bookings/exam-bookings.repository.js';
import type { ExamTypeSeed, SampleResultSeed, SpecialtySeed, UnitSeed } from './seed.data.js';

interface SpecialtyRef {
  id: string;
  council: string;
  isActive: boolean;
}

interface UnitRef {
  id: string;
  isActive: boolean;
}

interface DoctorProfileSeed {
  userId: string;
  specialty: SpecialtyRef;
  unitId: string;
  registryNumber: string;
  registryUf: string;
  now: Date;
}

export interface SampleBooking {
  booking: Omit<typeof bookings.$inferInsert, 'examTypeId' | 'lane'>;
  exam?: { examTypeId: string; capacity: number };
  events: Omit<typeof bookingEvents.$inferInsert, 'bookingId'>[];
  metrics?: HealthMetricsInput | undefined;
  results: readonly SampleResultSeed[];
}

export class SeedRepository {
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

  grantDoctorProfile({ userId, specialty, unitId, registryNumber, registryUf, now }: DoctorProfileSeed): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(doctorProfiles)
        .values({ userId, specialtyId: specialty.id, council: specialty.council, unitId, registryNumber, registryUf })
        .onConflictDoNothing({ target: doctorProfiles.userId });
      await tx.insert(userRoles).values({ userId, role: 'doctor', grantedAt: now }).onConflictDoNothing();
    });
  }

  async doctor(email: string) {
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
      .where(and(eq(users.email, email), isNull(users.deactivatedAt)));
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

  async addTimeOff(timeOff: typeof doctorTimeOff.$inferInsert): Promise<void> {
    await this.db.insert(doctorTimeOff).values(timeOff).onConflictDoNothing();
  }

  createBookings(sampleBookings: SampleBooking[]): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const examCodes: string[] = [];
      for (const { booking, exam, events, metrics } of sampleBookings) {
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
        await tx.insert(bookingEvents).values(events.map((event) => ({ ...event, bookingId: inserted.id })));
        if (metrics) await insertMetrics(tx, inserted.id, metrics, endsAt);
      }
      return examCodes;
    });
  }
}
