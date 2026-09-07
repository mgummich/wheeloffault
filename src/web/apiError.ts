/** Error type of both backends (HTTP server and in-browser session store). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * User-facing German message for any thrown error. Server errors are already
 * German; network failures ("Failed to fetch") are not.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError || (err instanceof Error && /fetch/i.test(err.message))) {
    return 'Verbindung fehlgeschlagen. Bitte erneut versuchen.';
  }
  return err instanceof Error ? err.message : String(err);
}
