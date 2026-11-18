import { BRAND, openPdf, PDF_COLORS, PDF_MARGIN, printable, type PdfColumn } from '../../lib/pdf.js';
import { clinicDateTime } from '../../lib/time.js';
import {
  civilDayLabel,
  EMPTY_REPORT,
  isEmptyReport,
  percentFormat,
  periodLabel,
  RANKINGS,
  REPORT_TITLE,
  SERIES_COLUMNS,
  seriesStartLabel,
  SUMMARY_KINDS,
  SUMMARY_LINES,
} from './admin-reports.export.js';
import type { AdminReport } from './admin-reports.model.js';

const TILE = { columns: 3, height: 44, gap: 8 };
const COLUMN_PADDING = 10;

const footer = (page: number, pages: number) => `${BRAND} · ${REPORT_TITLE} · Página ${page} de ${pages}`;

export function renderReportPdf(report: AdminReport, generatedAt: Date): Promise<Buffer> {
  const { doc, width, pair, header, keepSpace, table, finish } = openPdf({
    Title: REPORT_TITLE,
    Subject: periodLabel(report),
  });

  const fittedColumns = (labels: string[], widest: string[]): PdfColumn[] => {
    const natural = labels.map(
      (label, index) =>
        Math.max(
          doc.font('Helvetica-Bold').fontSize(8).widthOfString(label),
          doc.font('Helvetica-Bold').fontSize(9).widthOfString(widest[index] ?? ''),
        ) + COLUMN_PADDING,
    );
    const extra = (width - natural.reduce((total, size) => total + size, 0)) / labels.length;
    let x = PDF_MARGIN;
    return labels.map((label, index) => {
      const size = (natural[index] ?? 0) + extra;
      const column: PdfColumn = { label, x: x + 4, width: size - 8, align: index === 0 ? 'left' : 'right' };
      x += size;
      return column;
    });
  };

  const heading = (text: string) => {
    keepSpace(80);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_COLORS.ink).text(printable(text), PDF_MARGIN, doc.y);
    doc.moveDown(0.5);
  };

  const tiles = (values: { label: string; value: string }[]) => {
    const tileWidth = (width - TILE.gap * (TILE.columns - 1)) / TILE.columns;
    const rows = Math.ceil(values.length / TILE.columns);
    keepSpace(rows * (TILE.height + TILE.gap));
    const top = doc.y;
    values.forEach(({ label, value }, index) => {
      const x = PDF_MARGIN + (index % TILE.columns) * (tileWidth + TILE.gap);
      const y = top + Math.floor(index / TILE.columns) * (TILE.height + TILE.gap);
      doc.roundedRect(x, y, tileWidth, TILE.height, 6).fill(PDF_COLORS.band);
      doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.mute).text(printable(label), x + 10, y + 8, {
        width: tileWidth - 20,
        lineBreak: false,
      });
      doc.font('Helvetica-Bold').fontSize(14).fillColor(PDF_COLORS.ink).text(value, x + 10, y + 21, {
        width: tileWidth - 20,
        lineBreak: false,
      });
    });
    doc.y = top + rows * (TILE.height + TILE.gap);
    doc.moveDown(0.6);
  };

  header(REPORT_TITLE);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(PDF_COLORS.ink).text(printable(REPORT_TITLE.toUpperCase()));
  doc.moveDown(0.4);
  pair('Período', periodLabel(report));
  pair('Gerado em', clinicDateTime.format(generatedAt));
  doc.moveDown(0.8);

  if (isEmptyReport(report)) {
    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.mute).text(printable(EMPTY_REPORT));
    return finish(footer);
  }

  for (const kind of SUMMARY_KINDS) {
    heading(kind.label);
    tiles(
      SUMMARY_LINES.map(({ label, value, percent }) => {
        const amount = value(kind.of(report));
        return { label, value: amount === null ? '—' : percent ? percentFormat.format(amount) : String(amount) };
      }),
    );
  }

  heading(report.period.granularity === 'day' ? 'Agendamentos por dia' : 'Agendamentos por semana');
  table(
    fittedColumns(
      [seriesStartLabel(report), ...SERIES_COLUMNS.map(({ label }) => label)],
      ['00/00/0000', ...SERIES_COLUMNS.map(() => '00000')],
    ),
    report.series.map((bucket) => [
      civilDayLabel(bucket.start),
      ...SERIES_COLUMNS.map(({ key }) => ({ text: String(bucket[key]), bold: key === 'total' })),
    ]),
  );

  for (const ranking of RANKINGS) {
    const items = ranking.of(report);
    if (items.length === 0) continue;
    doc.moveDown(0.6);
    heading(ranking.heading);
    table(
      [
        { label: ranking.label, x: PDF_MARGIN + 4, width: width - 100 },
        { label: 'Agendamentos', x: PDF_MARGIN + width - 90, width: 86, align: 'right' },
      ],
      items.map(({ name, total }) => [name, String(total)]),
    );
  }

  return finish(footer);
}
