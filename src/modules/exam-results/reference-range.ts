interface NumericRange {
  low: number;
  high: number;
}

const THOUSANDS = String.raw`-?[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?`;
const PLAIN = String.raw`-?\d+(?:[.,]\d+)?`;
const RANGE = new RegExp(String.raw`^\s*(${THOUSANDS}|${PLAIN})\s*(?:a|até|-|–|—)\s*(${THOUSANDS}|${PLAIN})\s*$`, 'i');
const DOT_THOUSANDS = new RegExp(String.raw`^${THOUSANDS}$`);
const DOT_DECIMAL = /^-?\d+\.\d+$/;

function parseNumber(text: string, dotIsDecimal: boolean): number {
  if (text.includes(',')) return Number(text.replaceAll('.', '').replace(',', '.'));
  return !dotIsDecimal && DOT_THOUSANDS.test(text) ? Number(text.replaceAll('.', '')) : Number(text);
}

export function parseReferenceRange(text: string | null): NumericRange | null {
  const match = text ? RANGE.exec(text.normalize('NFC')) : null;
  if (!match?.[1] || !match[2]) return null;
  const sides = [match[1], match[2]];
  const dotIsDecimal = sides.some((side) => DOT_DECIMAL.test(side) && !DOT_THOUSANDS.test(side));
  const [low = Number.NaN, high = Number.NaN] = sides.map((side) => parseNumber(side, dotIsDecimal));
  return Number.isFinite(low) && Number.isFinite(high) && low < high ? { low, high } : null;
}
