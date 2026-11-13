const UNIQUE_VIOLATION = '23505';

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

export function uniqueConstraintOf(error: unknown): string | undefined {
  const pgError = findPgError(error);
  return pgError?.code === UNIQUE_VIOLATION ? pgError.constraint : undefined;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = findPgError(error);
  return pgError?.code === UNIQUE_VIOLATION && pgError.constraint === constraint;
}
