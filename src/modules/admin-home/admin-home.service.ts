import type { Clock } from '../../lib/clock.js';
import { CLINIC_TIME_ZONE, dayRangeIn } from '../../lib/time.js';
import type { AdminHome } from './admin-home.model.js';
import type { AdminHomeRepository } from './admin-home.repository.js';

export class AdminHomeService {
  constructor(
    private readonly repository: AdminHomeRepository,
    private readonly clock: Clock,
  ) {}

  async summary(): Promise<AdminHome> {
    const now = this.clock.now();
    const [patients, doctors, appointmentsToday] = await Promise.all([
      this.repository.activeAccounts('patient'),
      this.repository.activeAccounts('doctor'),
      this.repository.appointmentsBetween(dayRangeIn(CLINIC_TIME_ZONE, now), now),
    ]);
    return { patients, doctors, appointmentsToday };
  }
}
