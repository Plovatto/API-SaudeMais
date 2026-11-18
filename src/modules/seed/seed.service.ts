import { randomBytes } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { AppError } from '../../lib/app-error.js';
import { systemActor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { civilDate, CLINIC_TIME_ZONE, DAY, HOUR, instantOfWallClock, MINUTE, wallClockIn } from '../../lib/time.js';
import { WORKDAYS } from '../../lib/week.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import { newPublicCode } from '../exam-bookings/exam-bookings.code.js';
import type { LabIntegrationService } from '../lab-integration/lab-integration.service.js';
import { EXAMPLE_DOCTOR, EXAMPLE_PATIENT, type SeedAccount } from '../users/user.seed.js';
import type { UserService } from '../users/user.service.js';
import {
  EXAM_TYPES,
  EXAMPLE_DOCTOR_PROFILE,
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

type ExampleDoctor = NonNullable<Awaited<ReturnType<SeedRepository['exampleDoctor']>>>;

const SYSTEM = { actorType: 'system' as const, actorUserId: null };

function sampleDay(now: Date, dayOffset: number): number {
  const step = dayOffset < 0 ? -DAY : DAY;
  const wallNow = wallClockIn(CLINIC_TIME_ZONE, now);
  let day = wallNow - (wallNow % DAY) + dayOffset * DAY;
  while (!(WORKDAYS as readonly number[]).includes(new Date(day).getUTCDay())) day += step;
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
  ) {}

  async seed(): Promise<string[]> {
    const warnings = await this.ensureExampleDoctor();
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
    await this.ensureExamplePatient();
    return warnings;
  }

  private async ensureExampleDoctor(): Promise<string[]> {
    if (await this.repository.userIdByEmail(EXAMPLE_DOCTOR.email)) return [];
    const userId = await this.users.createSeedAccount(EXAMPLE_DOCTOR);
    if (!userId) return [];
    const warnings = await this.grantProfile(userId, EXAMPLE_DOCTOR.email, EXAMPLE_DOCTOR_PROFILE);
    if (warnings.length === 0) await this.schedules.ensureDefault(userId);
    return warnings;
  }

  private async ensureExamplePatient(): Promise<void> {
    if (await this.repository.userIdByEmail(EXAMPLE_PATIENT.email)) return;
    const patientId = await this.users.createSeedAccount(EXAMPLE_PATIENT);
    const doctor = await this.repository.exampleDoctor(EXAMPLE_DOCTOR.email);
    if (!patientId || !doctor) return;
    const now = this.clock.now();
    await this.repository.addTimeOff({
      doctorId: doctor.id,
      date: civilDate(sampleDay(now, SAMPLE_TIME_OFF.dayOffset)),
      reason: SAMPLE_TIME_OFF.reason,
      createdAt: now,
    });
    const sampleBookings: SampleBooking[] = [];
    for (const seed of SAMPLE_BOOKINGS) {
      const sampleBooking = await this.sampleBooking(seed, patientId, doctor, now);
      if (sampleBooking) sampleBookings.push(sampleBooking);
    }
    const examCodes = await this.repository.insertSampleBookings(sampleBookings);
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
    doctor: ExampleDoctor,
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

  private async createSampleAccount({ fullName, email }: Pick<SeedAccount, 'fullName' | 'email'>) {
    if (await this.repository.userIdByEmail(email)) return undefined;
    return this.users.createSeedAccount({ fullName, email, password: randomPassword(), roles: ['patient'] });
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
