import PDFDocument from 'pdfkit';
import { CLINIC_TIME_ZONE } from '../../lib/time.js';
import type { ExamResult, ResultItemView } from './exam-results.model.js';

const COLORS = { brand: '#0c7c7e', ink: '#132322', mute: '#637372', line: '#d0d9d9', band: '#edf4f4', low: '#8a5600', high: '#b3302f' };
const MARGIN = 48;
const COLUMNS = { name: MARGIN, value: 250, reference: 360, flag: 480 };

const flagLabels: Record<ResultItemView['flag'], string> = {
  normal: 'Normal',
  low: 'Baixo',
  high: 'Alto',
  critical: 'Crítico',
};

const flagColor = (flag: ResultItemView['flag']) =>
  flag === 'normal' ? COLORS.ink : flag === 'low' ? COLORS.low : COLORS.high;

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: CLINIC_TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

const formatValue = ({ value, unit }: ResultItemView) =>
  `${typeof value === 'number' ? numberFormat.format(value) : value}${unit ? ` ${unit}` : ''}`;

export function resultFileName(result: ExamResult): string {
  return `laudo-${result.booking.publicCode}.pdf`;
}

export function renderResultPdf(result: ExamResult, patientName: string, printedAt: Date): Promise<Buffer> {
  const { booking, current } = result;
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: `Laudo ${booking.examType.name}`, Author: 'Saúde+', Subject: booking.publicCode },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - MARGIN * 2;
  const rule = (color = COLORS.line) => {
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).lineWidth(0.6).strokeColor(color).stroke();
  };
  const pair = (label: string, value: string) => {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.mute).text(label, { continued: true });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(`  ${value}`);
  };

  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.brand).text('Saúde+');
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.mute).text(`${booking.unit.name} · ${booking.unit.address}`);
  doc.moveDown(0.6);
  rule(COLORS.brand);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.ink).text(booking.examType.name.toUpperCase());
  doc.moveDown(0.4);
  pair('Paciente', patientName);
  pair('Código do exame', booking.publicCode);
  pair('Realizado em', dateTime.format(new Date(booking.startsAt)));
  pair('Emitido em', dateTime.format(new Date(current.issuedAt)));
  if (current.status === 'amended') pair('Versão', `${current.version} (retificação)`);
  doc.moveDown(0.8);

  if (current.items) {
    const header = doc.y;
    doc.rect(MARGIN, header - 3, width, 16).fill(COLORS.band);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.mute);
    doc.text('Exame', COLUMNS.name + 4, header, { lineBreak: false });
    doc.text('Resultado', COLUMNS.value, header, { lineBreak: false });
    doc.text('Referência', COLUMNS.reference, header, { lineBreak: false });
    doc.text('Indicador', COLUMNS.flag, header, { lineBreak: false });
    doc.y = header + 18;
    for (const item of current.items) {
      if (doc.y > doc.page.height - MARGIN - 40) doc.addPage();
      const top = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
      doc.text(item.name, COLUMNS.name + 4, top, { width: COLUMNS.value - COLUMNS.name - 12 });
      const bottom = doc.y;
      doc.font(item.flag === 'normal' ? 'Helvetica' : 'Helvetica-Bold').fillColor(flagColor(item.flag));
      doc.text(formatValue(item), COLUMNS.value, top, { width: COLUMNS.reference - COLUMNS.value - 8 });
      doc.font('Helvetica').fillColor(COLORS.mute);
      doc.text(item.referenceRange ?? '—', COLUMNS.reference, top, { width: COLUMNS.flag - COLUMNS.reference - 8 });
      doc.font('Helvetica-Bold').fillColor(flagColor(item.flag)).text(flagLabels[item.flag], COLUMNS.flag, top);
      doc.y = Math.max(bottom, doc.y) + 6;
      rule();
      doc.y += 6;
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text('Laudo');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink).text(current.report ?? '', { width, lineGap: 3 });
  }

  doc.moveDown(1.5);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.mute)
    .text(
      `Os indicadores comparam cada resultado com a faixa de referência do laboratório. Converse com seu médico sobre o que eles significam para você. Gerado pelo Saúde+ em ${dateTime.format(printedAt)}.`,
      MARGIN,
      doc.y,
      { width },
    );
  doc.end();
  return done;
}
