import type { AdminInsights, AdminReport, ReportFormat } from './admin-reports.model.js';

type KindTotals = AdminReport['appointments'] | AdminReport['exams'];
type StatusKey = Exclude<keyof AdminReport['series'][number], 'start'>;

interface SummaryLine {
  label: string;
  value: (totals: KindTotals) => number | null;
  percent?: boolean;
}

export const REPORT_TITLE = 'Relatório de agendamentos';
export const EMPTY_REPORT = 'Nenhum agendamento no período.';

export const SUMMARY_KINDS = [
  { label: 'Consultas', of: (report: AdminReport): KindTotals => report.appointments },
  { label: 'Exames', of: (report: AdminReport): KindTotals => report.exams },
] as const;

export const SUMMARY_LINES: SummaryLine[] = [
  { label: 'Total', value: ({ total }) => total },
  { label: 'A confirmar', value: ({ pending }) => pending },
  { label: 'Confirmados', value: ({ confirmed }) => confirmed },
  { label: 'Aguardando registro', value: ({ awaitingRecord }) => awaitingRecord },
  { label: 'Realizados', value: ({ completed }) => completed },
  { label: 'Faltas', value: ({ noShow }) => noShow },
  { label: 'Taxa de faltas', value: (totals) => ('noShowRate' in totals ? totals.noShowRate : null), percent: true },
  { label: 'Expirados', value: ({ expired }) => expired },
  { label: 'Cancelados', value: ({ cancelled }) => cancelled },
  { label: 'Cancelamentos tardios', value: ({ lateCancellations }) => lateCancellations },
  { label: 'Cancelados pelo paciente', value: ({ cancelledBy }) => cancelledBy.patient },
  { label: 'Cancelados pelo médico', value: ({ cancelledBy }) => cancelledBy.doctor },
  { label: 'Cancelados por administrador', value: ({ cancelledBy }) => cancelledBy.admin },
  { label: 'Cancelados pelo sistema', value: ({ cancelledBy }) => cancelledBy.system },
];

export const SERIES_COLUMNS: { key: StatusKey; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'completed', label: 'Realizados' },
  { key: 'noShow', label: 'Faltas' },
  { key: 'cancelled', label: 'Cancelados' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'pending', label: 'A confirmar' },
  { key: 'awaitingRecord', label: 'Aguardando registro' },
  { key: 'expired', label: 'Expirados' },
];

export const RANKINGS = [
  {
    sheet: 'Especialidades',
    heading: 'Especialidades mais procuradas',
    label: 'Especialidade',
    of: (report: AdminReport) => report.topSpecialties,
  },
  {
    sheet: 'Exames',
    heading: 'Exames mais procurados',
    label: 'Tipo de exame',
    of: (report: AdminReport) => report.topExamTypes,
  },
] as const;

export type ExportInsights = Pick<AdminInsights, 'doctors' | 'units'>;

interface BreakdownColumn<Row> {
  label: string;
  of: (row: Row) => number;
}

interface Outcomes {
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
}

const outcomeColumns = <Row extends Outcomes>(...kinds: BreakdownColumn<Row>[]): BreakdownColumn<Row>[] => [
  { label: 'Total', of: ({ total }) => total },
  ...kinds,
  { label: 'Realizados', of: ({ completed }) => completed },
  { label: 'Faltas', of: ({ noShow }) => noShow },
  { label: 'Cancelados', of: ({ cancelled }) => cancelled },
];

function breakdown<Row extends Outcomes & { name: string }>(
  sheet: string,
  heading: string,
  label: string,
  rowsOf: (insights: ExportInsights) => Row[],
  columns: BreakdownColumn<Row>[],
) {
  return {
    sheet,
    heading,
    labels: columns.map((column) => column.label),
    label,
    of: (insights: ExportInsights) =>
      rowsOf(insights).map((row) => ({ name: row.name, values: columns.map((column) => column.of(row)) })),
  };
}

export const BREAKDOWNS = [
  breakdown<ExportInsights['doctors'][number]>(
    'Médicos',
    'Médicos com mais consultas',
    'Médico',
    ({ doctors }) => doctors,
    outcomeColumns(),
  ),
  breakdown<ExportInsights['units'][number]>(
    'Unidades',
    'Agendamentos por unidade',
    'Unidade',
    ({ units }) => units,
    outcomeColumns(
      { label: 'Consultas', of: ({ appointments }) => appointments },
      { label: 'Exames', of: ({ exams }) => exams },
    ),
  ),
];

export const percentFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export const civilDayLabel = (date: string) => date.split('-').reverse().join('/');

export const periodLabel = ({ period }: AdminReport) => `${civilDayLabel(period.from)} a ${civilDayLabel(period.to)}`;

export const seriesStartLabel = ({ period }: AdminReport) =>
  period.granularity === 'day' ? 'Dia' : 'Início da semana';

export const isEmptyReport = ({ appointments, exams }: AdminReport) => appointments.total + exams.total === 0;

export const reportFileName = ({ period }: AdminReport, format: ReportFormat) =>
  `relatorio_${period.from}_a_${period.to}.${format}`;
