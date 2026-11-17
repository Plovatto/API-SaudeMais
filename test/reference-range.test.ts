import { describe, expect, it } from 'vitest';
import { aboutItem } from '@/modules/exam-results/exam-results.glossary.js';
import { parseReferenceRange } from '@/modules/exam-results/reference-range.js';

describe('parseReferenceRange', () => {
  it.each([
    ['12,0 a 16,0', { low: 12, high: 16 }],
    ['4.0 - 5.2', { low: 4, high: 5.2 }],
    ['70–99', { low: 70, high: 99 }],
    ['150.000 a 450.000', { low: 150000, high: 450000 }],
    ['4.000 até 11.000', { low: 4000, high: 11000 }],
    ['1.234,5 a 2.000,75', { low: 1234.5, high: 2000.75 }],
    ['-2 a 2', { low: -2, high: 2 }],
    ['  0 A 5 ', { low: 0, high: 5 }],
  ])('reads %s', (text, range) => {
    expect(parseReferenceRange(text)).toEqual(range);
  });

  it.each([null, '', 'Negativo', '< 200', 'inferior a 5,7', 'Até 99', '16 a 12', '5 a 5', '12 a 16 mg/dL'])(
    'gives no range for %s',
    (text) => {
      expect(parseReferenceRange(text)).toBeNull();
    },
  );
});

describe('aboutItem', () => {
  it('explains known items ignoring accents, case and spaces', () => {
    expect(aboutItem('Hematócrito')).toBe(aboutItem('  HEMATOCRITO '));
    expect(aboutItem('Glicose  em jejum')).toMatch(/açúcar/);
  });

  it('has no explanation for unknown items', () => {
    expect(aboutItem('Item desconhecido')).toBeNull();
  });
});
