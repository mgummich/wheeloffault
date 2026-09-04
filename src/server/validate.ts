import { DomainError } from '../domain/errors.ts';

/** Small, explicit checks for untrusted request bodies. Throws DomainError('invalid'). */

export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DomainError('Body muss ein JSON-Objekt sein');
  }
  return body as Record<string, unknown>;
}

export function str(obj: Record<string, unknown>, key: string, max = 500): string {
  const v = obj[key];
  if (typeof v !== 'string') throw new DomainError(`${key} muss ein String sein`);
  if (v.length > max) throw new DomainError(`${key} länger als ${max} Zeichen`);
  return v;
}

export function optionalStr(obj: Record<string, unknown>, key: string, max = 500): string | null {
  if (obj[key] === undefined || obj[key] === null) return null;
  return str(obj, key, max);
}

export function strArray(obj: Record<string, unknown>, key: string, maxItems = 500): string[] {
  const v = obj[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new DomainError(`${key} muss eine Liste von Strings sein`);
  }
  if (v.length > maxItems) throw new DomainError(`${key}: höchstens ${maxItems} Einträge`);
  return v as string[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function id(value: string, what = 'id'): string {
  if (!ID.test(value)) throw new DomainError(`${what} ist ungültig`);
  return value;
}
