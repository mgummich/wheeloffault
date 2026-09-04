/** Thrown by domain functions on invalid transitions. Mapped to HTTP status by the server. */
export class DomainError extends Error {
  readonly code: 'invalid' | 'not_found' | 'conflict';
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: 'invalid' | 'not_found' | 'conflict' = 'invalid',
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
