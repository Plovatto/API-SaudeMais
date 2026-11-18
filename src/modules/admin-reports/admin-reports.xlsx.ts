import writeXlsxFile, { type Cell, type Row, type Sheet } from 'write-excel-file/node';
import { PDF_COLORS } from '../../lib/pdf.js';
import { clinicDateTime } from '../../lib/time.js';
import {
  periodLabel,
  RANKINGS,
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
    backgroundColor: PDF_COLORS.brand,
  }));

const tableSheet = (sheet: string, labels: string[], rows: Row[], widths: number[]): Sheet<Buffer> => ({
  sheet,
  data: [headerRow(labels), ...rows],
  columns: widths.map((width) => ({ width })),
  stickyRowsCount: 1,
});

const civilDate = (date: string) => new Date(`${date}T00:00:00Z`);

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
    [...rows, [], ['Período', periodLabel(report)], ['Gerado em', clinicDateTime.format(generatedAt)]],
    [24, 16, 16],
  );
}

function seriesSheet(report: AdminReport): Sheet<Buffer> {
  return tableSheet(
    'Série',
    [seriesStartLabel(report), ...SERIES_COLUMNS.map(({ label }) => label)],
    report.series.map((bucket) => [
      { value: civilDate(bucket.start), type: Date, format: DATE },
      ...SERIES_COLUMNS.map(({ key }) => ({ value: bucket[key], type: Number })),
    ]),
    [18, ...SERIES_COLUMNS.map(({ label }) => Math.max(12, label.length + 2))],
  );
}

export function renderReportXlsx(report: AdminReport, generatedAt: Date): Promise<Buffer> {
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
  ];
  return writeXlsxFile(workbook).toBuffer();
}
