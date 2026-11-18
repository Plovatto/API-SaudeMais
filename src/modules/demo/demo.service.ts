import { randomBytes } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { AppError } from '../../lib/app-error.js';
import { systemActor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { CLINIC_TIME_ZONE, DAY, HOUR, instantOfWallClock, MINUTE, startOfDayIn, wallClockIn } from '../../lib/time.js';
import { WORKDAYS } from '../../lib/week.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import { newPublicCode } from '../exam-bookings/exam-bookings.code.js';
import type { LabIntegrationService } from '../lab-integration/lab-integration.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { DEMO_ACCOUNTS, DEMO_DOCTOR, DEMO_PATIENT, type SeedAccount } from '../users/user.demo.js';
import { SeedAccountConflictError, type UserService } from '../users/user.service.js';
import {
  DEMO_BOOKINGS,
  DEMO_DOCTOR_PROFILE,
  DEMO_LAB,
  EXAM_TYPES,
  OFFERS,
  SAMPLE_DOCTORS,
  SAMPLE_PATIENTS,
  SPECIALTIES,
  UNITS,
  type DemoBookingSeed,
  type DoctorProfileTarget,
} from './demo.data.js';
import type { DemoBooking, DemoRepository, RestoredDemo } from './demo.repository.js';

const randomPassword = () => randomBytes(24).toString('base64url');

type DemoDoctor = NonNullable<Awaited<ReturnType<DemoRepository['demoDoctor']>>>;

const SYSTEM = { actorType: 'system' as const, actorUserId: null };

function demoStart(now: Date, { dayOffset, minute }: DemoBookingSeed): Date {
  const step = dayOffset < 0 ? -DAY : DAY;
  const wallNow = wallClockIn(CLINIC_TIME_ZONE, now);
  let day = wallNow - (wallNow % DAY) + dayOffset * DAY;
  while (!(WORKDAYS as readonly number[]).includes(new Date(day).getUTCDay())) day += step;
  return instantOfWallClock(CLINIC_TIME_ZONE, day + minute * MINUTE);
}

export class DemoService {
  constructor(
    private readonly repository: DemoRepository,
    private readonly users: UserService,
    private readonly schedules: DoctorScheduleService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
    private readonly lab: LabIntegrationService,
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
    const warnings = await this.grantProfile(userId, DEMO_DOCTOR.email, DEMO_DOCTOR_PROFILE);
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

  async restore(): Promise<RestoredDemo | undefined> {
    const now = this.clock.now();
    for (const account of [...DEMO_ACCOUNTS, DEMO_DOCTOR]) await this.users.restoreAccount(account);
    await this.ensure();
    const patientId = await this.repository.userIdByEmail(DEMO_PATIENT.email);
    const doctor = await this.repository.demoDoctor(DEMO_DOCTOR.email);
    if (!patientId || !doctor) return undefined;
    const demoBookings: DemoBooking[] = [];
    for (const seed of DEMO_BOOKINGS) {
      const demoBooking = await this.demoBooking(seed, patientId, doctor, now);
      if (demoBooking) demoBookings.push(demoBooking);
    }
    const restoration = await this.repository.restoreBookings(startOfDayIn(CLINIC_TIME_ZONE, now), now, demoBookings);
    if (!restoration) return undefined;
    this.notifications.forget(restoration.recipients);
    await this.publishResults(demoBookings, restoration.examCodes, now).catch((error: unknown) => {
      logger.warn(
        { code: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR' },
        'Demo exam results not published',
      );
    });
    return restoration.restored;
  }

  private async publishResults(demoBookings: DemoBooking[], examCodes: string[], now: Date) {
    const publications = demoBookings.flatMap(({ booking: { publicCode, endsAt }, results }) =>
      publicCode && examCodes.includes(publicCode)
        ? results.map((result, index) => ({
            ...result,
            externalId: `DEMO-${publicCode}`,
            examCode: publicCode,
            issuedAt: new Date(Math.min(now.getTime(), endsAt.getTime() + (index + 1) * HOUR)).toISOString(),
          }))
        : [],
    );
    if (publications.length === 0) return;
    const clientId = await this.demoLabClient();
    if (!clientId) return;
    for (const publication of publications) await this.lab.publish(publication, { clientId, ip: null });
  }

  private async demoLabClient(): Promise<string | undefined> {
    const client = await this.repository.integrationClient(DEMO_LAB);
    if (!client) return (await this.lab.createClient({ name: DEMO_LAB }, systemActor)).id;
    if (!client.revokedAt && !client.createdBy) return client.id;
    logger.warn({ code: client.revokedAt ? 'DEMO_LAB_REVOKED' : 'DEMO_LAB_NOT_SYSTEM' }, 'Demo exam results skipped');
    return undefined;
  }

  private async demoBooking(
    seed: DemoBookingSeed,
    patientId: string,
    doctor: DemoDoctor,
    now: Date,
  ): Promise<DemoBooking | undefined> {
    const startsAt = demoStart(now, seed);
    const [initial, ...transitions] = seed.history;
    const offer = seed.kind === 'exam' ? await this.repository.examOffer(doctor.unitId, seed.examType) : undefined;
    const endsAt = new Date(startsAt.getTime() + (offer?.durationMin ?? doctor.durationMin) * MINUTE);
    const columns = { patientId, unitId: doctor.unitId, startsAt, endsAt, status: transitions.at(-1) ?? initial };
    let placement: Pick<DemoBooking, 'booking' | 'exam' | 'results'>;
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
