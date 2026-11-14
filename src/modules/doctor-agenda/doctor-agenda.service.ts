import type { Clock } from '../../lib/clock.js';
import { civilDate, CLINIC_TIME_ZONE, dayRangeIn, wallClockIn } from '../../lib/time.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { DoctorAppointmentPage, DoctorAppointmentsQuery, DoctorHome } from './doctor-agenda.model.js';
import type { DoctorAgendaRepository } from './doctor-agenda.repository.js';

export class DoctorAgendaService {
  constructor(
    private readonly repository: DoctorAgendaRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  page(doctorId: string, query: DoctorAppointmentsQuery): Promise<DoctorAppointmentPage> {
    return this.repository.page(doctorId, query, this.clock.now());
  }

  async home(doctorId: string): Promise<DoctorHome> {
    const now = this.clock.now();
    const [{ today, ...agenda }, lastNotification] = await Promise.all([
      this.repository.home(doctorId, dayRangeIn(CLINIC_TIME_ZONE, now), now),
      this.notifications.latest({ userId: doctorId, role: 'doctor' }),
    ]);
    return { today: { date: civilDate(wallClockIn(CLINIC_TIME_ZONE, now)), ...today }, ...agenda, lastNotification };
  }
}
