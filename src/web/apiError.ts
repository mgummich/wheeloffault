import { en as messages } from './i18n/en.ts';
import { t } from './i18n/index.ts';
import type { MessageKey } from './i18n/messages.ts';

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
 * User-facing, localized message for any thrown error. Server/session errors
 * carry a stable machine `code` in their body; a known code is localized,
 * an unknown one falls back to the raw (English) message. Network failures
 * ("Failed to fetch") are not ApiErrors at all.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.body.code;
    const key = `error.${code}` as MessageKey;
    if (typeof code === 'string' && key in messages) return t(key);
    return err.message;
  }
  if (err instanceof TypeError || (err instanceof Error && /fetch/i.test(err.message))) {
    return t('apiError.connectionFailed');
  }
  return err instanceof Error ? err.message : String(err);
}
