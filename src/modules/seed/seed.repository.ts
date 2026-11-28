import { and, count, eq, isNull, ne, notInArray } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { bookingEvents, bookings } from '../../database/schema/bookings.js';
import { examTypes, specialties, unitExamOffers, unitHours, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { doctorTimeOff } from '../../database/schema/doctor-schedule.js';
import { integrationClients } from '../../database/schema/integration-clients.js';
import { emailPreferences } from '../../database/schema/email-preferences.js';
import { sessions } from '../../database/schema/sessions.js';
import { userRoles, users, type Role } from '../../database/schema/users.js';
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

export interface ExampleAccountSpec {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string;
  roles: readonly Role[];
  specialtyId: string;
  council: string;
  unitId: string;
  registryNumber: string;
  registryUf: string;
}

const profileKey = { userId: doctorProfiles.userId };

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

  async exampleState(id: string) {
    const [user] = await this.db
      .select({
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        birthDate: users.birthDate,
        passwordHash: users.passwordHash,
        deactivatedAt: users.deactivatedAt,
      })
      .from(users)
      .where(eq(users.id, id));
    if (!user) return undefined;
    const roleRows = await this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, id));
    const [profile] = await this.db
      .select({
        specialtyId: doctorProfiles.specialtyId,
        unitId: doctorProfiles.unitId,
        registryNumber: doctorProfiles.registryNumber,
        registryUf: doctorProfiles.registryUf,
        appointmentDurationMin: doctorProfiles.appointmentDurationMin,
      })
      .from(doctorProfiles)
      .where(eq(doctorProfiles.userId, id));
    const [preferences] = await this.db
      .select({ total: count() })
      .from(emailPreferences)
      .where(eq(emailPreferences.userId, id));
    return { ...user, roles: roleRows.map(({ role }) => role).sort(), profile, preferences: preferences?.total ?? 0 };
  }

  restoreExample(spec: ExampleAccountSpec, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.update(specialties).set({ isActive: true }).where(eq(specialties.id, spec.specialtyId));
      await tx.update(units).set({ isActive: true }).where(eq(units.id, spec.unitId));
      const account = {
        fullName: spec.fullName,
        email: spec.email,
        phone: null,
        birthDate: null,
        passwordHash: spec.passwordHash,
        passwordChangedAt: null,
        deactivatedAt: null,
        updatedAt: now,
      };
      await tx
        .insert(users)
        .values({ id: spec.id, ...account })
        .onConflictDoUpdate({ target: users.id, set: account });
      const [registryHolder] = await tx
        .select({ userId: doctorProfiles.userId })
        .from(doctorProfiles)
        .where(
          and(
            eq(doctorProfiles.council, spec.council),
            eq(doctorProfiles.registryUf, spec.registryUf),
            eq(doctorProfiles.registryNumber, spec.registryNumber),
            ne(doctorProfiles.userId, spec.id),
          ),
        )
        .for('update');
      const place = {
        specialtyId: spec.specialtyId,
        council: spec.council,
        unitId: spec.unitId,
        appointmentDurationMin: null,
      };
      const profile = { ...place, registryNumber: spec.registryNumber, registryUf: spec.registryUf };
      const saved = registryHolder
        ? await tx.update(doctorProfiles).set(place).where(eq(doctorProfiles.userId, spec.id)).returning(profileKey)
        : await tx
            .insert(doctorProfiles)
            .values({ userId: spec.id, ...profile })
            .onConflictDoUpdate({ target: doctorProfiles.userId, set: profile })
            .returning(profileKey);
      const roles = saved.length > 0 ? [...spec.roles] : spec.roles.filter((role) => role !== 'doctor');
      await tx.delete(userRoles).where(and(eq(userRoles.userId, spec.id), notInArray(userRoles.role, roles)));
      await tx
        .insert(userRoles)
        .values(roles.map((role) => ({ userId: spec.id, role, grantedAt: now })))
        .onConflictDoNothing();
      await tx.delete(sessions).where(eq(sessions.userId, spec.id));
      await tx.delete(emailPreferences).where(eq(emailPreferences.userId, spec.id));
      return registryHolder === undefined;
    });
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
