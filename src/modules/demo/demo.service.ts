import { randomBytes } from 'node:crypto';
import type { Clock } from '../../lib/clock.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import { DEMO_DOCTOR, type SeedAccount } from '../users/user.demo.js';
import { SeedAccountConflictError, type UserService } from '../users/user.service.js';
import {
  DEMO_DOCTOR_PROFILE,
  EXAM_TYPES,
  OFFERS,
  SAMPLE_DOCTORS,
  SAMPLE_PATIENTS,
  SPECIALTIES,
  UNITS,
  type DoctorProfileTarget,
} from './demo.data.js';
import type { DemoRepository } from './demo.repository.js';

const randomPassword = () => randomBytes(24).toString('base64url');

export class DemoService {
  constructor(
    private readonly repository: DemoRepository,
    private readonly users: UserService,
    private readonly schedules: DoctorScheduleService,
    private readonly clock: Clock,
  ) {}

  async ensure(): Promise<string[]> {
    try {
      await this.users.ensureAccount(DEMO_DOCTOR);
    } catch (error) {
      if (error instanceof SeedAccountConflictError) return [error.message];
      throw error;
    }
    const userId = await this.repository.userIdByEmail(DEMO_DOCTOR.email);
    if (!userId) return [];
    const warnings = (await this.repository.hasDoctorProfile(userId))
      ? []
      : await this.grantProfile(userId, DEMO_DOCTOR.email, DEMO_DOCTOR_PROFILE);
    await this.schedules.ensureDefault(userId);
    return warnings;
  }

  async seed(): Promise<string[]> {
    const warnings = await this.ensure();
    for (const specialty of SPECIALTIES) await this.repository.ensureSpecialty(specialty);
    for (const unit of UNITS) await this.repository.ensureUnit(unit);
    const examTypeIds = new Map<string, string>();
    for (const examType of EXAM_TYPES) {
      const id = await this.repository.ensureExamType(examType);
      if (id) examTypeIds.set(examType.code, id);
    }
    for (const offer of OFFERS) {
      const unit = await this.unit(offer.unit);
      const examTypeId = examTypeIds.get(offer.examType);
      if (unit && examTypeId) await this.repository.ensureOffer(unit.id, examTypeId, offer.capacityPerSlot);
    }
    for (const { fullName, email, ...profile } of SAMPLE_DOCTORS) {
      const created = await this.createSampleAccount({ fullName, email });
      if (created) warnings.push(...(await this.grantProfile(created, email, profile)));
      const userId = created ?? (await this.repository.userIdByEmail(email));
      if (userId) await this.schedules.ensureDefault(userId);
    }
    for (const patient of SAMPLE_PATIENTS) await this.createSampleAccount(patient);
    return warnings;
  }

  private async createSampleAccount({ fullName, email }: Pick<SeedAccount, 'fullName' | 'email'>) {
    if (await this.repository.userIdByEmail(email)) return undefined;
    await this.users.ensureAccount({
      fullName,
      email,
      password: randomPassword(),
      roles: ['patient'],
      isProtected: false,
    });
    return this.repository.userIdByEmail(email);
  }

  private unit(name: string) {
    const seed = UNITS.find((unit) => unit.name === name);
    return seed ? this.repository.ensureUnit(seed) : Promise.resolve(undefined);
  }

  private async grantProfile(userId: string, email: string, target: DoctorProfileTarget): Promise<string[]> {
    const specialtySeed = SPECIALTIES.find((specialty) => specialty.name === target.specialty);
    const specialty = specialtySeed ? await this.repository.ensureSpecialty(specialtySeed) : undefined;
    const unit = await this.unit(target.unit);
    if (!specialty?.isActive || !unit?.isActive) {
      return [`Doctor profile for ${email} skipped: ${target.specialty} or ${target.unit} is missing or inactive`];
    }
    try {
      await this.repository.grantDoctorProfile({
        userId,
        specialty,
        unitId: unit.id,
        registryNumber: target.registryNumber,
        registryUf: target.registryUf,
        now: this.clock.now(),
      });
      return [];
    } catch (error) {
      if (!isUniqueViolation(error, 'doctor_profiles_registry_key')) throw error;
      return [
        `Doctor profile for ${email} skipped: registry ${target.registryNumber}/${target.registryUf} already in use`,
      ];
    }
  }
}
