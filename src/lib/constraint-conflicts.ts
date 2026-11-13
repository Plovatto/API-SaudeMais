import { conflictError, type FieldConflict } from './app-error.js';
import { violatedConstraint } from './pg-errors.js';

export async function withConstraintConflicts<T>(
  write: () => Promise<T>,
  conflicts: Record<string, FieldConflict>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const constraint = violatedConstraint(error);
    const conflict = constraint && Object.hasOwn(conflicts, constraint) ? conflicts[constraint] : undefined;
    if (conflict) throw conflictError(conflict);
    throw error;
  }
}
