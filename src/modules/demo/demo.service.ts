import { randomBytes } from 'node:crypto';
import { DEMO_DOCTOR, type SeedAccount } from '../users/user.demo.js';
import type { UserService } from '../users/user.service.js';
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
import type { DemoRepository, SpecialtyRef } from './demo.repository.js';

type DoctorTarget = DoctorProfileTarget & { account: SeedAccount };

const randomPassword = () => randomBytes(24).toString('base64url');

export class DemoService {
  constructor(
    private readonly repository: DemoRepository,
    private readonly users: UserService,
  ) {}

  async ensure(): Promise<void> {
    await this.ensureDoctors([{ account: DEMO_DOCTOR, ...DEMO_DOCTOR_PROFILE }]);
  }

  async seed(): Promise<void> {
    await this.ensure();
    const examTypeIds = new Map<string, string>();
    for (const examType of EXAM_TYPES) {
      const id = await this.repository.ensureExamType(examType);
      if (id) examTypeIds.set(examType.code, id);
    }
    const unitIds = await this.ensureUnits(UNITS.map((unit) => unit.name));
    for (const offer of OFFERS) {
      const unitId = unitIds.get(offer.unit);
      const examTypeId = examTypeIds.get(offer.examType);
      if (unitId && examTypeId) await this.repository.ensureOffer(unitId, examTypeId, offer.capacityPerSlot);
    }
    await this.ensureDoctors(
      SAMPLE_DOCTORS.map(({ fullName, email, ...profile }) => ({
        account: { fullName, email, password: randomPassword(), roles: ['patient', 'doctor'], isProtected: false },
        ...profile,
      })),
    );
    for (const patient of SAMPLE_PATIENTS) {
      await this.ensureSampleAccount({
        ...patient,
        password: randomPassword(),
        roles: ['patient'],
        isProtected: false,
      });
    }
  }

  private async ensureSampleAccount(account: SeedAccount): Promise<void> {
    if (!(await this.repository.userIdByEmail(account.email))) await this.users.ensureAccount(account);
  }

  private async ensureUnits(names: readonly string[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const unit of UNITS.filter((seed) => names.includes(seed.name))) {
      const id = await this.repository.ensureUnit(unit);
      if (id) ids.set(unit.name, id);
    }
    return ids;
  }

  private async ensureSpecialties(names: readonly string[]): Promise<Map<string, SpecialtyRef>> {
    const refs = new Map<string, SpecialtyRef>();
    for (const specialty of SPECIALTIES.filter((seed) => names.includes(seed.name))) {
      const ref = await this.repository.ensureSpecialty(specialty);
      if (ref) refs.set(specialty.name, ref);
    }
    return refs;
  }

  private async ensureDoctors(doctors: readonly DoctorTarget[]): Promise<void> {
    const specialties = await this.ensureSpecialties(doctors.map((doctor) => doctor.specialty));
    const units = await this.ensureUnits(doctors.map((doctor) => doctor.unit));
    for (const { account, specialty, unit, registryNumber, registryUf } of doctors) {
      const specialtyRef = specialties.get(specialty);
      const unitId = units.get(unit);
      if (!specialtyRef || !unitId) continue;
      await (account.isProtected ? this.users.ensureAccount(account) : this.ensureSampleAccount(account));
      const userId = await this.repository.userIdByEmail(account.email);
      if (userId) {
        await this.repository.ensureDoctorProfile({
          userId,
          specialty: specialtyRef,
          unitId,
          registryNumber,
          registryUf,
        });
      }
    }
  }
}
