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

const REPLACEMENTS: Record<string, string> = {
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '−': '-',
  'μ': 'µ',
  ...Object.fromEntries([...'⁰⁴⁵⁶⁷⁸⁹'].map((char, index) => [char, `^${'0456789'[index]}`])),
};

const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const isWinAnsi = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return [0x09, 0x0a, 0x0d].includes(code) || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code);
};

export const printable = (text: string) =>
  [...text.normalize('NFC')].map((char) => REPLACEMENTS[char] ?? (isWinAnsi(char) ? char : '?')).join('');

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
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.mute)
    .text(printable(`${booking.unit.name} · ${booking.unit.address}`));
  doc.moveDown(0.6);
  rule(COLORS.brand);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.ink).text(printable(booking.examType.name.toUpperCase()));
  doc.moveDown(0.4);
  pair('Paciente', printable(patientName));
  pair('Código do exame', booking.publicCode);
  pair('Realizado em', dateTime.format(new Date(booking.startsAt)));
  pair('Emitido em', dateTime.format(new Date(current.issuedAt)));
  if (current.status === 'amended') pair('Versão', `${current.version} (retificação)`);
  doc.moveDown(0.8);

  const tableHeader = () => {
    const top = doc.y;
    doc.rect(MARGIN, top - 3, width, 16).fill(COLORS.band);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.mute);
    doc.text('Exame', COLUMNS.name + 4, top, { lineBreak: false });
    doc.text('Resultado', COLUMNS.value, top, { lineBreak: false });
    doc.text('Referência', COLUMNS.reference, top, { lineBreak: false });
    doc.text('Indicador', COLUMNS.flag, top, { lineBreak: false });
    doc.y = top + 18;
  };

  if (current.items) {
    tableHeader();
    for (const item of current.items) {
      if (doc.y > doc.page.height - MARGIN - 48) {
        doc.addPage();
        tableHeader();
      }
      const top = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
      doc.text(printable(item.name), COLUMNS.name + 4, top, { width: COLUMNS.value - COLUMNS.name - 12 });
      const bottom = doc.y;
      doc.font(item.flag === 'normal' ? 'Helvetica' : 'Helvetica-Bold').fillColor(flagColor(item.flag));
      doc.text(printable(formatValue(item)), COLUMNS.value, top, { width: COLUMNS.reference - COLUMNS.value - 8 });
      doc.font('Helvetica').fillColor(COLORS.mute);
      doc.text(printable(item.referenceRange ?? '—'), COLUMNS.reference, top, {
        width: COLUMNS.flag - COLUMNS.reference - 8,
      });
      doc.font('Helvetica-Bold').fillColor(flagColor(item.flag)).text(flagLabels[item.flag], COLUMNS.flag, top);
      doc.y = Math.max(bottom, doc.y) + 6;
      rule();
      doc.y += 6;
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text('Laudo');
    doc.moveDown(0.4);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.ink)
      .text(printable(current.report ?? ''), { width, lineGap: 3 });
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
