import type { Clock } from '../../lib/clock.js';
import { CLINIC_TIME_ZONE, DAY, HOUR, startOfDayIn } from '../../lib/time.js';
import type { AdminHome } from './admin-home.model.js';
import type { AdminHomeRepository } from './admin-home.repository.js';

export class AdminHomeService {
  constructor(
    private readonly repository: AdminHomeRepository,
    private readonly clock: Clock,
  ) {}

  async summary(): Promise<AdminHome> {
    const start = startOfDayIn(CLINIC_TIME_ZONE, this.clock.now());
    const end = startOfDayIn(CLINIC_TIME_ZONE, new Date(start.getTime() + DAY + 2 * HOUR));
    const [patients, doctors, appointmentsToday] = await Promise.all([
      this.repository.activeAccounts('patient'),
      this.repository.activeAccounts('doctor'),
      this.repository.appointmentsBetween({ start, end }),
    ]);
    return { patients, doctors, appointmentsToday };
  }
}
