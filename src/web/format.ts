import { getLang, t } from './i18n/index.ts';

const localeFor = (lang: string) => (lang === 'de' ? 'de-DE' : 'en-US');

// Caches one Intl formatter instance per active locale (there are only two:
// en-US/de-DE) instead of constructing one per call — call sites like the
// per-participant percent() run every animation tick.
function cached<T>(make: (locale: string) => T): (locale: string) => T {
  const cache = new Map<string, T>();
  return (locale: string) => {
    let v = cache.get(locale);
    if (!v) {
      v = make(locale);
      cache.set(locale, v);
    }
    return v;
  };
}

const numberFormat = cached(
  (locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
);
const number2Format = cached(
  (locale) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
);
const dateTimeFormat = cached(
  (locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
);
const relativeTimeFormat = cached(
  (locale) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
);

export const num = (n: number) => numberFormat(localeFor(getLang())).format(n);

export const num2 = (n: number) => number2Format(localeFor(getLang())).format(n);

export const percent = (ratio: number) => `${num(ratio * 100)} %`;

export const factor = (thousandths: number) => `${num2(thousandths / 1000)}×`;

export function dateTime(iso: string): string {
  return dateTimeFormat(localeFor(getLang())).format(new Date(iso));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return t('format.justNow');
  const rtf = relativeTimeFormat(localeFor(getLang()));
  if (abs < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(-Math.round(seconds / 86400), 'day');
  return rtf.format(-Math.round(seconds / (86400 * 30)), 'month');
}

/** Display label of a draw, e.g. "SR 0042". Used everywhere a spin is named. */
export function spinLabel(nonce: number): string {
  return `SR ${String(nonce).padStart(4, '0')}`;
}

export function probabilityOf(
  participants: { memberId: string; weight: number }[],
  memberId: string,
) {
  const total = participants.reduce((s, p) => s + p.weight, 0);
  const own = participants.find((p) => p.memberId === memberId)?.weight ?? 0;
  return total === 0 ? 0 : own / total;
}
