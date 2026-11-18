import PDFDocument from 'pdfkit';

export const BRAND = 'Saúde+';
export const PDF_COLORS = { brand: '#0c7c7e', ink: '#132322', mute: '#637372', line: '#d0d9d9', band: '#edf4f4' };
export const PDF_MARGIN = 48;

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

export interface PdfColumn {
  label: string;
  x: number;
  width: number;
  align?: 'left' | 'right';
}

export type PdfCell = string | { text: string; color?: string; bold?: boolean };

export function openPdf(info: PDFKit.DocumentInfo) {
  const doc = new PDFDocument({ size: 'A4', margin: PDF_MARGIN, bufferPages: true, info: { Author: BRAND, ...info } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - PDF_MARGIN * 2;
  const bottom = () => doc.page.height - PDF_MARGIN;

  const rule = (color = PDF_COLORS.line) => {
    doc.moveTo(PDF_MARGIN, doc.y).lineTo(PDF_MARGIN + width, doc.y).lineWidth(0.6).strokeColor(color).stroke();
  };

  const pair = (label: string, value: string) => {
    doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.mute).text(label, { continued: true });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_COLORS.ink).text(`  ${printable(value)}`);
  };

  const header = (subtitle: string) => {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(PDF_COLORS.brand).text(BRAND);
    doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.mute).text(printable(subtitle));
    doc.moveDown(0.6);
    rule(PDF_COLORS.brand);
    doc.moveDown(0.8);
  };

  const keepSpace = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  const table = (columns: PdfColumn[], rows: PdfCell[][]) => {
    const tableHeader = () => {
      const top = doc.y;
      doc.rect(PDF_MARGIN, top - 3, width, 16).fill(PDF_COLORS.band);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.mute);
      for (const { label, x, width: columnWidth, align } of columns) {
        doc.text(label, x, top, { width: columnWidth, align, lineBreak: false });
      }
      doc.y = top + 18;
    };
    tableHeader();
    for (const row of rows) {
      if (doc.y > bottom() - 48) {
        doc.addPage();
        tableHeader();
      }
      const top = doc.y;
      let end = top;
      row.forEach((cell, index) => {
        const { text, color = PDF_COLORS.ink, bold = false } = typeof cell === 'string' ? { text: cell } : cell;
        const { x, width: columnWidth, align } = columns[index] ?? { x: PDF_MARGIN, width };
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color);
        doc.text(printable(text), x, top, { width: columnWidth, align });
        end = Math.max(end, doc.y);
      });
      doc.y = end + 6;
      rule();
      doc.y += 6;
    }
  };

  const finish = (footer?: (page: number, pages: number) => string) => {
    if (footer) {
      const { start, count } = doc.bufferedPageRange();
      for (let index = start; index < start + count; index++) {
        doc.switchToPage(index);
        doc.page.margins.bottom = 0;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(PDF_COLORS.mute)
          .text(printable(footer(index + 1, count)), PDF_MARGIN, doc.page.height - PDF_MARGIN + 16, {
            width,
            align: 'center',
            lineBreak: false,
          });
      }
    }
    doc.end();
    return done;
  };

  return { doc, width, rule, pair, header, keepSpace, table, finish };
}
