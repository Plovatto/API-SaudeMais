import '../docs/zod-extend.js';
import { z } from 'zod';

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const WORKDAYS = [1, 2, 3, 4, 5] as const;

export const weekday = z.int().min(0).max(6).openapi({ description: '0 = domingo, 6 = sábado.', example: 1 });

const minuteOfDay = (min: number, max: number) =>
  z.int().min(min).max(max).multipleOf(5, 'Use múltiplos de 5 minutos.');

export const startMinute = minuteOfDay(0, 1435);
export const endMinute = minuteOfDay(5, 1440);

export function endsAfterStart<T extends z.ZodType, S extends string, E extends string>(
  schema: T,
  start: S,
  end: E,
  message: string,
): T {
  return schema.refine(
    (value) => {
      const period = value as Record<S | E, number>;
      return period[start] < period[end];
    },
    { path: [end], message },
  );
}

export const weekList = <T extends z.ZodType<{ weekday: number }>>(item: T) =>
  z
    .array(item)
    .refine(
      (items) => new Set(items.map((entry) => entry.weekday)).size === items.length,
      'Informe cada dia uma vez só.',
    );
