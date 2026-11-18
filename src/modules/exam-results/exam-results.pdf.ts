import { openPdf, PDF_COLORS, PDF_MARGIN, printable, type PdfColumn } from '../../lib/pdf.js';
import { clinicDateTime } from '../../lib/time.js';
import type { ExamResult, ResultItemView } from './exam-results.model.js';

const FLAG_COLORS = { low: '#8a5600', high: '#b3302f' };
const COLUMNS = { name: PDF_MARGIN, value: 250, reference: 360, flag: 480 };

const flagLabels: Record<ResultItemView['flag'], string> = {
  normal: 'Normal',
  low: 'Baixo',
  high: 'Alto',
  critical: 'Crítico',
};

const flagColor = (flag: ResultItemView['flag']) =>
  flag === 'normal' ? PDF_COLORS.ink : flag === 'low' ? FLAG_COLORS.low : FLAG_COLORS.high;

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

const formatValue = ({ value, unit }: ResultItemView) =>
  `${typeof value === 'number' ? numberFormat.format(value) : value}${unit ? ` ${unit}` : ''}`;

const itemColumns = (width: number): PdfColumn[] => [
  { label: 'Exame', x: COLUMNS.name + 4, width: COLUMNS.value - COLUMNS.name - 12 },
  { label: 'Resultado', x: COLUMNS.value, width: COLUMNS.reference - COLUMNS.value - 8 },
  { label: 'Referência', x: COLUMNS.reference, width: COLUMNS.flag - COLUMNS.reference - 8 },
  { label: 'Indicador', x: COLUMNS.flag, width: PDF_MARGIN + width - COLUMNS.flag },
];

export function resultFileName(result: ExamResult): string {
  return `laudo-${result.booking.publicCode}.pdf`;
}

export function renderResultPdf(result: ExamResult, patientName: string, printedAt: Date): Promise<Buffer> {
  const { booking, current } = result;
  const { doc, width, pair, header, table, finish } = openPdf({
    Title: `Laudo ${booking.examType.name}`,
    Subject: booking.publicCode,
  });

  header(`${booking.unit.name} · ${booking.unit.address}`);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(PDF_COLORS.ink).text(printable(booking.examType.name.toUpperCase()));
  doc.moveDown(0.4);
  pair('Paciente', patientName);
  pair('Código do exame', booking.publicCode);
  pair('Realizado em', clinicDateTime.format(new Date(booking.startsAt)));
  pair('Emitido em', clinicDateTime.format(new Date(current.issuedAt)));
  if (current.status === 'amended') pair('Versão', `${current.version} (retificação)`);
  doc.moveDown(0.8);

  if (current.items) {
    table(
      itemColumns(width),
      current.items.map((item) => [
        item.name,
        { text: formatValue(item), color: flagColor(item.flag), bold: item.flag !== 'normal' },
        { text: item.referenceRange ?? '—', color: PDF_COLORS.mute },
        { text: flagLabels[item.flag], color: flagColor(item.flag), bold: true },
      ]),
    );
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_COLORS.ink).text('Laudo');
    doc.moveDown(0.4);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(PDF_COLORS.ink)
      .text(printable(current.report ?? ''), { width, lineGap: 3 });
  }

  doc.moveDown(1.5);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(PDF_COLORS.mute)
    .text(
      `Os indicadores comparam cada resultado com a faixa de referência do laboratório. Converse com seu médico sobre o que eles significam para você. Gerado pelo Saúde+ em ${clinicDateTime.format(printedAt)}.`,
      PDF_MARGIN,
      doc.y,
      { width },
    );
  return finish();
}
