import { eq, or } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { examTypes, specialties, unitExamOffers, unitHours, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { users } from '../../database/schema/users.js';
import type { ExamTypeSeed, SpecialtySeed, UnitSeed } from './demo.data.js';

export interface SpecialtyRef {
  id: string;
  council: string;
}

export interface DoctorProfileSeed {
  userId: string;
  specialty: SpecialtyRef;
  unitId: string;
  registryNumber: string;
  registryUf: string;
}

export class DemoRepository {
  constructor(private readonly db: Database) {}

  async ensureSpecialty(seed: SpecialtySeed): Promise<SpecialtyRef | undefined> {
    await this.db.insert(specialties).values(seed).onConflictDoNothing();
    const [row] = await this.db
      .select({ id: specialties.id, council: specialties.council })
      .from(specialties)
      .where(eq(specialties.name, seed.name));
    return row;
  }

  async ensureUnit({ hours, ...seed }: UnitSeed): Promise<string | undefined> {
    await this.db.insert(units).values(seed).onConflictDoNothing();
    const [row] = await this.db.select({ id: units.id }).from(units).where(eq(units.name, seed.name));
    if (row) {
      await this.db
        .insert(unitHours)
        .values(hours.map((hour) => ({ ...hour, unitId: row.id })))
        .onConflictDoNothing();
    }
    return row?.id;
  }

  async ensureExamType(seed: ExamTypeSeed): Promise<string | undefined> {
    await this.db.insert(examTypes).values(seed).onConflictDoNothing();
    const [row] = await this.db
      .select({ id: examTypes.id })
      .from(examTypes)
      .where(or(eq(examTypes.code, seed.code), eq(examTypes.name, seed.name)));
    return row?.id;
  }

  async ensureOffer(unitId: string, examTypeId: string, capacityPerSlot: number): Promise<void> {
    await this.db.insert(unitExamOffers).values({ unitId, examTypeId, capacityPerSlot }).onConflictDoNothing();
  }

  async userIdByEmail(email: string): Promise<string | undefined> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row?.id;
  }

  async ensureDoctorProfile({
    userId,
    specialty,
    unitId,
    registryNumber,
    registryUf,
  }: DoctorProfileSeed): Promise<void> {
    await this.db
      .insert(doctorProfiles)
      .values({ userId, specialtyId: specialty.id, council: specialty.council, unitId, registryNumber, registryUf })
      .onConflictDoNothing();
  }
}
