import type { Clock } from '../../lib/clock.js';
import { civilDate, civilDateIn, civilPeriodIn, CLINIC_TIME_ZONE, DAY } from '../../lib/time.js';
import { noStatusTotals } from '../bookings/bookings.repository.js';
import {
  DEFAULT_REPORT_DAYS,
  MAX_DAILY_DAYS,
  rateOf,
  reportPeriod,
  type AdminReport,
  type ReportsQuery,
} from './admin-reports.model.js';
import type { AdminReportsRepository } from './admin-reports.repository.js';

const noKindTotals = {
  ...noStatusTotals,
  lateCancellations: 0,
  cancelledBy: { patient: 0, doctor: 0, admin: 0, system: 0 },
};

const shiftDays = (date: string, days: number) => civilDate(Date.parse(date) + days * DAY);

export class AdminReportsService {
  constructor(
    private readonly repository: AdminReportsRepository,
    private readonly clock: Clock,
  ) {}

  async report(query: ReportsQuery): Promise<AdminReport> {
    const now = this.clock.now();
    const to = query.to ?? civilDateIn(CLINIC_TIME_ZONE, now);
    const period = reportPeriod.parse({ from: query.from ?? shiftDays(to, 1 - DEFAULT_REPORT_DAYS), to });
    const length = (Date.parse(period.to) - Date.parse(period.from)) / DAY + 1;
    const days = length > MAX_DAILY_DAYS ? 7 : 1;
    const { kinds, series, topSpecialties, topExamTypes } = await this.repository.report(
      civilPeriodIn(CLINIC_TIME_ZONE, period),
      { from: period.from, days },
      now,
    );
    const byKind = new Map(kinds.map(({ kind, ...totals }) => [kind, totals]));
    const byBucket = new Map(series.map(({ bucket, ...totals }) => [bucket, totals]));
    const appointments = byKind.get('appointment') ?? noKindTotals;
    return {
      period: { ...period, granularity: days === 1 ? 'day' : 'week' },
      appointments: { ...appointments, noShowRate: rateOf(appointments.noShow, appointments.completed) },
      exams: byKind.get('exam') ?? noKindTotals,
      series: Array.from({ length: Math.ceil(length / days) }, (_, index) => ({
        start: shiftDays(period.from, index * days),
        ...(byBucket.get(index) ?? noStatusTotals),
      })),
      topSpecialties,
      topExamTypes,
    };
  }
}
