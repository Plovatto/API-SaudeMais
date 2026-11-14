export type FieldErrors = Record<string, string>;

export interface FieldConflict {
  code: string;
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldErrors) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(`AppError status must be between 400 and 599, received ${status}`);
    }
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function unprocessable(code: string, message: string, fields?: FieldErrors): AppError {
  return new AppError(422, code, message, fields);
}

export function unprocessableField({ code, field, message }: FieldConflict): AppError {
  return unprocessable(code, message, { [field]: message });
}

export function conflictError({ code, field, message }: FieldConflict): AppError {
  return new AppError(409, code, message, { [field]: message });
}
