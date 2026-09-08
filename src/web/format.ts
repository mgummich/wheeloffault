import { getLang, t } from './i18n/index.ts';

const localeFor = (lang: string) => (lang === 'de' ? 'de-DE' : 'en-US');

export const num = (n: number, locale = localeFor(getLang())) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

export const num2 = (n: number, locale = localeFor(getLang())) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export const percent = (ratio: number, locale = localeFor(getLang())) =>
  `${num(ratio * 100, locale)} %`;

export const factor = (thousandths: number, locale = localeFor(getLang())) =>
  `${num2(thousandths / 1000, locale)}×`;

export function dateTime(iso: string, locale = localeFor(getLang())): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function relativeTime(iso: string, now = Date.now(), locale = localeFor(getLang())): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return t('format.justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
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
