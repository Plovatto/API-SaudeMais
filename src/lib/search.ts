import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

export const searchText = z.string().trim().max(120, 'A busca pode ter até 120 caracteres.').optional();

export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

export function unaccentMatch(column: AnyPgColumn, search: string): SQL {
  return sql`unaccent(${column}) ilike unaccent(${likePattern(search)})`;
}
