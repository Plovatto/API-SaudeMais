import writeXlsxFile, { type Cell, type Row, type Sheet } from 'write-excel-file/node';
import { BRAND_COLOR } from '../../lib/brand.js';
import { clinicDateTime } from '../../lib/time.js';
import {
  BREAKDOWNS,
  type ExportInsights,
  periodLabel,
  RANKINGS,
  REPORT_TITLE,
  SERIES_COLUMNS,
  seriesStartLabel,
  SUMMARY_KINDS,
  SUMMARY_LINES,
} from './admin-reports.export.js';
import type { AdminReport } from './admin-reports.model.js';

type Workbook = Sheet<Buffer>[];

const PERCENT = '0.0%';
const DATE = 'dd/mm/yyyy';

const headerRow = (labels: string[]): Row =>
  labels.map((value) => ({
    value,
    fontWeight: 'bold',
    textColor: '#ffffff',
    backgroundColor: BRAND_COLOR,
  }));

const tableSheet = (
  sheet: string,
  labels: string[],
  rows: Row[],
  widths: number[],
  intro: Row[] = [],
): Sheet<Buffer> => ({
  sheet,
  data: [...intro, headerRow(labels), ...rows],
  columns: widths.map((width) => ({ width })),
  stickyRowsCount: intro.length + 1,
});

const sheetDate = (date: string) => new Date(`${date}T00:00:00Z`);

const summaryCell = (amount: number | null, percent = false): Cell =>
  amount === null ? null : { value: amount, type: Number, ...(percent && { format: PERCENT }) };

function summarySheet(report: AdminReport, generatedAt: Date): Sheet<Buffer> {
  const rows: Row[] = SUMMARY_LINES.map(({ label, value, percent }) => [
    label,
    ...SUMMARY_KINDS.map((kind) => summaryCell(value(kind.of(report)), percent)),
  ]);
  return tableSheet(
    'Resumo',
    ['Indicador', ...SUMMARY_KINDS.map(({ label }) => label)],
    rows,
    [26, 16, 16],
    [
      [{ value: REPORT_TITLE, fontWeight: 'bold' }],
      ['Período', periodLabel(report)],
      ['Gerado em', clinicDateTime.format(generatedAt)],
      [],
    ],
  );
}

function seriesSheet(report: AdminReport): Sheet<Buffer> {
  return tableSheet(
    'Série',
    [seriesStartLabel(report), ...SERIES_COLUMNS.map(({ label }) => label)],
    report.series.map((bucket) => [
      { value: sheetDate(bucket.start), type: Date, format: DATE },
      ...SERIES_COLUMNS.map(({ key }) => ({ value: bucket[key], type: Number })),
    ]),
    [18, ...SERIES_COLUMNS.map(({ label }) => Math.max(12, label.length + 2))],
  );
}

export function renderReportXlsx(report: AdminReport, insights: ExportInsights, generatedAt: Date): Promise<Buffer> {
  const workbook: Workbook = [
    summarySheet(report, generatedAt),
    seriesSheet(report),
    ...RANKINGS.map(({ sheet, label, of }) =>
      tableSheet(
        sheet,
        [label, 'Agendamentos'],
        of(report).map(({ name, total }) => [name, { value: total, type: Number }]),
        [36, 16],
      ),
    ),
    ...BREAKDOWNS.map(({ sheet, label, labels, of }) =>
      tableSheet(
        sheet,
        [label, ...labels],
        of(insights).map(({ name, values }) => [name, ...values.map((value) => ({ value, type: Number }))]),
        [36, ...labels.map((text) => Math.max(12, text.length + 2))],
      ),
    ),
  ];
  return writeXlsxFile(workbook).toBuffer();
}
