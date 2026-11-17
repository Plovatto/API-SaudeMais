export interface NumericRange {
  low: number;
  high: number;
}

const NUMBER = String.raw`-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?`;
const RANGE = new RegExp(String.raw`^\s*(${NUMBER})\s*(?:a|até|-|–|—)\s*(${NUMBER})\s*$`, 'i');

function parseNumber(text: string): number {
  if (text.includes(',')) return Number(text.replaceAll('.', '').replace(',', '.'));
  return /^-?\d{1,3}(?:\.\d{3})+$/.test(text) ? Number(text.replaceAll('.', '')) : Number(text);
}

export function parseReferenceRange(text: string | null): NumericRange | null {
  const match = text ? RANGE.exec(text) : null;
  if (!match?.[1] || !match[2]) return null;
  const low = parseNumber(match[1]);
  const high = parseNumber(match[2]);
  return Number.isFinite(low) && Number.isFinite(high) && low < high ? { low, high } : null;
}
