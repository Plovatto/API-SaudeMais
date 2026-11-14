import { eq } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { examTypes, specialties, unitExamOffers, unitHours, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { userRoles, users } from '../../database/schema/users.js';
import type { ExamTypeSeed, SpecialtySeed, UnitSeed } from './demo.data.js';

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
}
