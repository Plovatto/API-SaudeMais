import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import type { Page } from '../../lib/pagination.js';
import { civilPeriodIn, CLINIC_TIME_ZONE } from '../../lib/time.js';
import { slotDays } from '../../lib/time-slots.js';
import { exceptOwn } from '../bookings/bookings.repository.js';
import type { AuthContext } from '../users/user.service.js';
import { doctorNotFound } from './doctors.messages.js';
import type { Availability, AvailabilityQuery, Doctor, DoctorsQuery } from './doctors.model.js';
import type { DoctorsRepository } from './doctors.repository.js';

export class DoctorsService {
  constructor(
    private readonly repository: DoctorsRepository,
    private readonly clock: Clock,
  ) {}

  page(query: DoctorsQuery, viewerIsProtected: boolean): Promise<Page<Doctor>> {
    return this.repository.page(query, viewerIsProtected);
  }

  async availability(
    doctorId: string,
    { rescheduling, ...period }: AvailabilityQuery,
    { user, isProtected }: Pick<AuthContext, 'user' | 'isProtected'>,
  ): Promise<Availability> {
    const now = this.clock.now();
    const { start: from, end: to } = civilPeriodIn(CLINIC_TIME_ZONE, period);
    const context = await this.repository.bookingContext(
      doctorId,
      isProtected,
      { from, to, now },
      exceptOwn(user.id, rescheduling),
    );
    if (!context) throw new AppError(404, 'NOT_FOUND', doctorNotFound);
    return { days: slotDays({ ...context, ...period, now, timeZone: CLINIC_TIME_ZONE }) };
  }
}
