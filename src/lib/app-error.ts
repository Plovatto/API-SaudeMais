export type FieldErrors = Record<string, string>;

/**
 * Expected error that becomes an HTTP response with the body `{ message, code, fields? }`.
 * `message` is shown to the user (Portuguese); `code` is stable and lets the client choose its own text.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
