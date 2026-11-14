import { z } from 'zod';
import type { PgSelect } from 'drizzle-orm/pg-core';

export const paginationQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type Pagination = z.infer<typeof paginationQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export function offsetOf({ page, pageSize }: Pagination): number {
  return (page - 1) * pageSize;
}

export async function pageOf<Q extends PgSelect>(
  query: Q,
  { page, pageSize }: Pagination,
  total: () => Promise<number>,
) {
  const items: Awaited<Q> = await query.limit(pageSize).offset(offsetOf({ page, pageSize }));
  return { items, page, pageSize, total: await total() };
}
