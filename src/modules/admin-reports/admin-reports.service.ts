import type { Clock } from '../../lib/clock.js';
import { civilDate, civilDateIn, civilPeriodIn, CLINIC_TIME_ZONE, DAY } from '../../lib/time.js';
import { noStatusTotals } from '../bookings/bookings.repository.js';
import { reportFileName } from './admin-reports.export.js';
import {
  DEFAULT_REPORT_DAYS,
  MAX_DAILY_DAYS,
  rateOf,
  type AdminInsights,
  reportPeriod,
  type AdminReport,
  type ReportExportQuery,
  type ReportFormat,
  type ReportsQuery,
} from './admin-reports.model.js';
import { renderReportPdf } from './admin-reports.pdf.js';
import type { AdminReportsRepository } from './admin-reports.repository.js';
import { renderReportXlsx } from './admin-reports.xlsx.js';

const noKindTotals = {
  ...noStatusTotals,
  lateCancellations: 0,
  cancelledBy: { patient: 0, doctor: 0, admin: 0, system: 0 },
};

const noLeadTime = {
  sameDay: 0,
  upTo3Days: 0,
  upTo7Days: 0,
  upTo14Days: 0,
  upTo30Days: 0,
  over30Days: 0,
  medianHours: null,
  rescheduledBookings: 0,
  reschedules: 0,
};

function rendererFor(format: ReportFormat) {
  switch (format) {
    case 'pdf':
      return renderReportPdf;
    case 'xlsx':
      return renderReportXlsx;
  }
}

const shiftDays = (date: string, days: number) => civilDate(Date.parse(date) + days * DAY);

export class AdminReportsService {
  constructor(
    private readonly repository: AdminReportsRepository,
    private readonly clock: Clock,
  ) {}

  private periodOf(query: ReportsQuery, now: Date) {
    const to = query.to ?? civilDateIn(CLINIC_TIME_ZONE, now);
    const period = reportPeriod.parse({ from: query.from ?? shiftDays(to, 1 - DEFAULT_REPORT_DAYS), to });
    const length = (Date.parse(period.to) - Date.parse(period.from)) / DAY + 1;
    const days = length > MAX_DAILY_DAYS ? 7 : 1;
    return {
      range: civilPeriodIn(CLINIC_TIME_ZONE, period),
      buckets: { from: period.from, days },
      period: { ...period, granularity: days === 1 ? ('day' as const) : ('week' as const) },
      starts: Array.from({ length: Math.ceil(length / days) }, (_, index) => shiftDays(period.from, index * days)),
    };
  }

  async report(query: ReportsQuery, now = this.clock.now()): Promise<AdminReport> {
    const { range, buckets, period, starts } = this.periodOf(query, now);
    const { kinds, series, topSpecialties, topExamTypes } = await this.repository.report(range, buckets, now);
    const byKind = new Map(kinds.map(({ kind, ...totals }) => [kind, totals]));
    const byBucket = new Map(series.map(({ bucket, ...totals }) => [bucket, totals]));
    const appointments = byKind.get('appointment') ?? noKindTotals;
    return {
      period,
      appointments: { ...appointments, noShowRate: rateOf(appointments.noShow, appointments.completed) },
      exams: byKind.get('exam') ?? noKindTotals,
      series: starts.map((start, index) => ({ start, ...(byBucket.get(index) ?? noStatusTotals) })),
      topSpecialties,
      topExamTypes,
    };
  }

  async insights(query: ReportsQuery, now = this.clock.now()): Promise<AdminInsights> {
    const { range, buckets, period, starts } = this.periodOf(query, now);
    const { signups, leadTime, ...rest } = await this.repository.insights(range, buckets, now);
    const { rescheduledBookings, reschedules, ...lead } = leadTime[0] ?? noLeadTime;
    const byBucket = new Map(signups.map(({ bucket, total }) => [bucket, total]));
    return {
      period,
      ...rest,
      leadTime: lead,
      signups: {
        total: signups.reduce((total, bucket) => total + bucket.total, 0),
        series: starts.map((start, index) => ({ start, total: byBucket.get(index) ?? 0 })),
      },
      reschedules: { bookings: rescheduledBookings, total: reschedules },
    };
  }

  async export({ format, ...query }: ReportExportQuery) {
    const now = this.clock.now();
    const [report, insights] = await Promise.all([this.report(query, now), this.insights(query, now)]);
    return {
      fileName: reportFileName(report, format),
      content: await rendererFor(format)(report, insights, now),
    };
  }
}
