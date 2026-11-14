import type { Clock } from '../../lib/clock.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PatientBookingPage, PatientBookingsQuery, PatientHome } from './patient-bookings.model.js';
import type { PatientBookingsRepository } from './patient-bookings.repository.js';

const HOME_UPCOMING = 3;

export class PatientBookingsService {
  constructor(
    private readonly repository: PatientBookingsRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  page(patientId: string, query: PatientBookingsQuery): Promise<PatientBookingPage> {
    return this.repository.page(patientId, query, this.clock.now());
  }

  async home(patientId: string): Promise<PatientHome> {
    const [upcoming, notifications] = await Promise.all([
      this.page(patientId, { scope: 'upcoming', page: 1, pageSize: HOME_UPCOMING }),
      this.notifications.page({ userId: patientId, role: 'patient' }, { page: 1, pageSize: 1 }),
    ]);
    return { upcoming: upcoming.items, counts: upcoming.counts, lastNotification: notifications.items[0] ?? null };
  }
}
