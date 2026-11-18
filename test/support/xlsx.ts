import { strFromU8, unzipSync } from 'fflate';

type SheetCell = string | number | null;

export const EXCEL_EPOCH = 25569;

const xmlText = (xml: string) =>
  [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(([, text]) => text).join('');

const columnIndex = (letters: string) =>
  [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;

export function workbookOf(content: Buffer) {
  const files = unzipSync(new Uint8Array(content));
  const read = (name: string) => strFromU8(files[name] ?? new Uint8Array());
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    xmlText(item ?? ''),
  );
  const sheet = (index: number) => {
    const rows: SheetCell[][] = [];
    for (const [, number, body = ''] of read(`xl/worksheets/sheet${index}.xml`).matchAll(
      /<row r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g,
    )) {
      const row: SheetCell[] = [];
      for (const [, column = 'A', attributes = '', inner = ''] of body.matchAll(
        /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        row[columnIndex(column)] = attributes.includes('t="s"')
          ? (shared[Number(value)] ?? null)
          : attributes.includes('t="inlineStr"')
            ? xmlText(inner)
            : value === undefined
              ? null
              : Number(value);
      }
      rows[Number(number) - 1] = Array.from(row, (cell) => cell ?? null);
    }
    const width = Math.max(0, ...rows.map((row) => row?.length ?? 0));
    const padded = (row: SheetCell[]) => Array.from({ length: width }, (_, at) => row[at] ?? null);
    return Array.from(rows, (row = []) => (row.length === 0 ? [] : padded(row)));
  };
  const names = [...read('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(([, name]) => name);
  return { names, sheet, text: Object.keys(files).map(read).join('') };
}
