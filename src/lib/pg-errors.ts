const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const EXCLUSION_VIOLATION = '23P01';
const DEADLOCK_DETECTED = '40P01';
const CONFLICT_CODES = new Set([UNIQUE_VIOLATION, FOREIGN_KEY_VIOLATION, EXCLUSION_VIOLATION]);

interface PgError {
  code: string;
  constraint?: string;
}

function findPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === 'string' && {
          constraint: candidate.constraint,
        }),
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

function isViolation(error: unknown, code: string, constraint: string): boolean {
  const pgError = findPgError(error);
  return pgError?.code === code && pgError.constraint === constraint;
}

export const isUniqueViolation = (error: unknown, constraint: string) =>
  isViolation(error, UNIQUE_VIOLATION, constraint);

export const isExclusionViolation = (error: unknown, constraint: string) =>
  isViolation(error, EXCLUSION_VIOLATION, constraint);

export function violatedConstraint(error: unknown): string | undefined {
  const pgError = findPgError(error);
  return pgError && CONFLICT_CODES.has(pgError.code) ? pgError.constraint : undefined;
}

export async function retryOnDeadlock<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (findPgError(error)?.code !== DEADLOCK_DETECTED) throw error;
    return work();
  }
}
