const de = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const de2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n: number) => de.format(n);
export const num2 = (n: number) => de2.format(n);
export const percent = (ratio: number) => `${de.format(ratio * 100)} %`;
export const factor = (thousandths: number) => `${de2.format(thousandths / 1000)}×`;

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return 'gerade eben';
  if (abs < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(-Math.round(seconds / 86400), 'day');
  return rtf.format(-Math.round(seconds / (86400 * 30)), 'month');
}

export function probabilityOf(
  participants: { memberId: string; weight: number }[],
  memberId: string,
) {
  const total = participants.reduce((s, p) => s + p.weight, 0);
  const own = participants.find((p) => p.memberId === memberId)?.weight ?? 0;
  return total === 0 ? 0 : own / total;
}
