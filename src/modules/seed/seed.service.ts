import { randomBytes } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { AppError } from '../../lib/app-error.js';
import { systemActor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { civilDate, CLINIC_TIME_ZONE, DAY, HOUR, instantOfWallClock, MINUTE, wallClockIn } from '../../lib/time.js';
import { isWorkday } from '../../lib/week.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import { newPublicCode } from '../exam-bookings/exam-bookings.code.js';
import type { LabIntegrationService } from '../lab-integration/lab-integration.service.js';
import { hashPassword, verifyPassword } from '../users/user.password.js';
import type { SessionCache } from '../users/user.session-cache.js';
import type { SeedAccount, UserService } from '../users/user.service.js';
import {
  EXAM_TYPES,
  EXAMPLE_DOCTOR,
  EXAMPLE_DOCTOR_PROFILE,
  EXAMPLE_MULTI,
  EXAMPLE_MULTI_ID,
  EXAMPLE_MULTI_PROFILE,
  EXAMPLE_MULTI_ROLES,
  EXAMPLE_PATIENT,
  OFFERS,
  SAMPLE_BOOKINGS,
  SAMPLE_DOCTORS,
  SAMPLE_LAB,
  SAMPLE_PATIENTS,
  SAMPLE_TIME_OFF,
  SPECIALTIES,
  UNITS,
  type DoctorProfileTarget,
  type SampleBookingSeed,
} from './seed.data.js';
import type { SampleBooking, SeedRepository } from './seed.repository.js';

const randomPassword = () => randomBytes(24).toString('base64url');

type SampleDoctor = NonNullable<Awaited<ReturnType<SeedRepository['doctor']>>>;

const SYSTEM = { actorType: 'system' as const, actorUserId: null };

function sampleDay(now: Date, dayOffset: number): number {
  const step = dayOffset < 0 ? -DAY : DAY;
  const wallNow = wallClockIn(CLINIC_TIME_ZONE, now);
  let day = wallNow - (wallNow % DAY) + dayOffset * DAY;
  while (!isWorkday(new Date(day).getUTCDay())) day += step;
  return day;
}

function sampleStart(now: Date, { dayOffset, minute }: SampleBookingSeed): Date {
  return instantOfWallClock(CLINIC_TIME_ZONE, sampleDay(now, dayOffset) + minute * MINUTE);
}

export class SeedService {
  constructor(
    private readonly repository: SeedRepository,
    private readonly users: UserService,
    private readonly schedules: DoctorScheduleService,
    private readonly clock: Clock,
    private readonly lab: LabIntegrationService,
    private readonly sessions: SessionCache,
  ) {}

  async seed(): Promise<string[]> {
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
    const warnings: string[] = [];
    const exampleDoctor = await this.createDoctor(EXAMPLE_DOCTOR, EXAMPLE_DOCTOR_PROFILE, warnings);
    if (exampleDoctor) await this.addTimeOff(exampleDoctor);
    for (const { fullName, email, ...profile } of SAMPLE_DOCTORS) {
      await this.createDoctor({ fullName, email, password: randomPassword(), roles: ['patient'] }, profile, warnings);
    }
    for (const patient of SAMPLE_PATIENTS) {
      await this.createAccount({ ...patient, password: randomPassword(), roles: ['patient'] });
    }
    const examplePatient = await this.createAccount(EXAMPLE_PATIENT);
    if (examplePatient) await this.addSampleBookings(examplePatient);
    return warnings;
  }

  async seedMultiProfile(): Promise<string[]> {
    const warnings: string[] = [];
    try {
      await this.restoreExample(warnings);
    } catch (error) {
      if (!isUniqueViolation(error, 'users_email_key')) throw error;
      warnings.push('Example account not restored: its e-mail belongs to another account');
    }
    return warnings;
  }

  async restoreExample(warnings: string[] = []): Promise<boolean> {
    const place = await this.place(EXAMPLE_MULTI_PROFILE);
    if (!place) throw new Error('Example account specialty or unit could not be found or created');
    const { specialty, unit } = place;
    const state = await this.repository.exampleState(EXAMPLE_MULTI_ID);
    const roles = [...EXAMPLE_MULTI_ROLES].sort();
    const intact =
      specialty.isActive &&
      unit.isActive &&
      state !== undefined &&
      state.fullName === EXAMPLE_MULTI.fullName &&
      state.email.toLowerCase() === EXAMPLE_MULTI.email &&
      state.phone === null &&
      state.birthDate === null &&
      state.deactivatedAt === null &&
      state.roles.join() === roles.join() &&
      state.profile?.specialtyId === specialty.id &&
      state.profile.unitId === unit.id &&
      state.profile.registryNumber === EXAMPLE_MULTI_PROFILE.registryNumber &&
      state.profile.registryUf === EXAMPLE_MULTI_PROFILE.registryUf &&
      state.profile.appointmentDurationMin === null &&
      state.preferences === 0 &&
      (await verifyPassword(EXAMPLE_MULTI.password, state.passwordHash));
    if (intact) return false;
    const registryRestored = await this.repository.restoreExample(
      {
        id: EXAMPLE_MULTI_ID,
        fullName: EXAMPLE_MULTI.fullName,
        email: EXAMPLE_MULTI.email,
        passwordHash: await hashPassword(EXAMPLE_MULTI.password),
        roles,
        specialtyId: specialty.id,
        council: specialty.council,
        unitId: unit.id,
        registryNumber: EXAMPLE_MULTI_PROFILE.registryNumber,
        registryUf: EXAMPLE_MULTI_PROFILE.registryUf,
      },
      this.clock.now(),
    );
    if (!registryRestored) {
      const { registryNumber, registryUf } = EXAMPLE_MULTI_PROFILE;
      warnings.push(`Example account kept its registry: ${registryNumber}/${registryUf} belongs to another doctor`);
    }
    this.sessions.invalidateUser(EXAMPLE_MULTI_ID);
    await this.schedules.ensureDefault(EXAMPLE_MULTI_ID);
    return true;
  }

  private async createDoctor(
    account: SeedAccount,
    profile: DoctorProfileTarget,
    warnings: string[],
  ): Promise<string | undefined> {
    const userId = await this.createAccount(account);
    if (!userId) return undefined;
    const problems = await this.grantProfile(userId, account.email, profile);
    warnings.push(...problems);
    if (problems.length > 0) return undefined;
    await this.schedules.ensureDefault(userId);
    return userId;
  }

  private async createAccount(account: SeedAccount): Promise<string | undefined> {
    if (await this.repository.userIdByEmail(account.email)) return undefined;
    if (!(await this.users.ensureAccount(account))) return undefined;
    return this.repository.userIdByEmail(account.email);
  }

  private async addTimeOff(doctorId: string): Promise<void> {
    const now = this.clock.now();
    await this.repository.addTimeOff({
      doctorId,
      date: civilDate(sampleDay(now, SAMPLE_TIME_OFF.dayOffset)),
      reason: SAMPLE_TIME_OFF.reason,
      createdAt: now,
    });
  }

  private async addSampleBookings(patientId: string): Promise<void> {
    const now = this.clock.now();
    const doctor = await this.repository.doctor(EXAMPLE_DOCTOR.email);
    if (!doctor) return;
    const sampleBookings: SampleBooking[] = [];
    for (const seed of SAMPLE_BOOKINGS) {
      const sampleBooking = await this.sampleBooking(seed, patientId, doctor, now);
      if (sampleBooking) sampleBookings.push(sampleBooking);
    }
    const examCodes = await this.repository.createBookings(sampleBookings);
    await this.publishResults(sampleBookings, examCodes, now).catch((error: unknown) => {
      logger.warn(
        { code: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR' },
        'Sample exam results not published',
      );
    });
  }

  private async publishResults(sampleBookings: SampleBooking[], examCodes: string[], now: Date) {
    const publications = sampleBookings.flatMap(({ booking: { publicCode, endsAt }, results }) =>
      publicCode && examCodes.includes(publicCode)
        ? results.map((result, index) => ({
            ...result,
            externalId: `SAMPLE-${publicCode}`,
            examCode: publicCode,
            issuedAt: new Date(Math.min(now.getTime(), endsAt.getTime() + (index + 1) * HOUR)).toISOString(),
          }))
        : [],
    );
    if (publications.length === 0) return;
    const clientId = await this.sampleLabClient();
    if (!clientId) return;
    for (const publication of publications) await this.lab.publish(publication, { clientId, ip: null });
  }

  private async sampleLabClient(): Promise<string | undefined> {
    const client = await this.repository.integrationClient(SAMPLE_LAB);
    if (!client) return (await this.lab.createClient({ name: SAMPLE_LAB }, systemActor)).id;
    if (!client.revokedAt && !client.createdBy) return client.id;
    logger.warn(
      { code: client.revokedAt ? 'SAMPLE_LAB_REVOKED' : 'SAMPLE_LAB_NOT_SYSTEM' },
      'Sample exam results skipped',
    );
    return undefined;
  }

  private async sampleBooking(
    seed: SampleBookingSeed,
    patientId: string,
    doctor: SampleDoctor,
    now: Date,
  ): Promise<SampleBooking | undefined> {
    const startsAt = sampleStart(now, seed);
    const [initial, ...transitions] = seed.history;
    const offer = seed.kind === 'exam' ? await this.repository.examOffer(doctor.unitId, seed.examType) : undefined;
    const endsAt = new Date(startsAt.getTime() + (offer?.durationMin ?? doctor.durationMin) * MINUTE);
    const columns = { patientId, unitId: doctor.unitId, startsAt, endsAt, status: transitions.at(-1) ?? initial };
    let placement: Pick<SampleBooking, 'booking' | 'exam' | 'results'>;
    if (seed.kind === 'appointment') {
      const { visitType } = seed;
      placement = {
        booking: { ...columns, kind: 'appointment', doctorId: doctor.id, specialtyId: doctor.specialtyId, visitType },
        results: [],
      };
    } else if (offer) {
      const { examTypeId, capacity } = offer;
      placement = {
        booking: { ...columns, kind: 'exam', publicCode: newPublicCode() },
        exam: { examTypeId, capacity },
        results: seed.results ?? [],
      };
    } else {
      return undefined;
    }
    const actor = seed.kind === 'appointment' ? { actorType: 'doctor' as const, actorUserId: doctor.id } : SYSTEM;
    const createdAt = Math.min(now.getTime() - HOUR, startsAt.getTime() - 7 * DAY);
    return {
      ...placement,
      metrics: seed.kind === 'appointment' ? seed.metrics : undefined,
      events: [
        {
          eventType: 'created',
          actorType: 'patient',
          actorUserId: patientId,
          toStatus: initial,
          createdAt: new Date(createdAt),
        },
        ...transitions.map((status, index) => ({
          ...actor,
          eventType: status,
          fromStatus: seed.history[index],
          toStatus: status,
          createdAt: status === 'completed' ? endsAt : new Date(createdAt + (index + 1) * 10 * MINUTE),
        })),
      ],
    };
  }

  private unit(name: string) {
    const seed = UNITS.find((unit) => unit.name === name);
    return seed ? this.repository.ensureUnit(seed) : Promise.resolve(undefined);
  }

  private async place(target: DoctorProfileTarget) {
    const specialtySeed = SPECIALTIES.find((specialty) => specialty.name === target.specialty);
    const specialty = specialtySeed ? await this.repository.ensureSpecialty(specialtySeed) : undefined;
    const unit = await this.unit(target.unit);
    return specialty && unit ? { specialty, unit } : undefined;
  }

  private async doctorPlace(target: DoctorProfileTarget) {
    const place = await this.place(target);
    return place?.specialty.isActive && place.unit.isActive ? place : undefined;
  }

  private async grantProfile(userId: string, email: string, target: DoctorProfileTarget): Promise<string[]> {
    const place = await this.doctorPlace(target);
    if (!place) {
      return [`Doctor profile for ${email} skipped: ${target.specialty} or ${target.unit} is missing or inactive`];
    }
    const { specialty, unit } = place;
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
