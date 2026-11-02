import type { Prayer } from '../db/schema';
import { getLang } from '../i18n';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = () => toISO(new Date());

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// أرقام لاتينية في العربية أيضًا لوضوح الجداول
const loc = () => (getLang() === 'ar' ? 'ar-u-nu-latn' : 'tr-TR');
const fmt = (o: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(loc(), o).format(d);

export const dayName = (iso: string) => fmt({ weekday: 'long' }, fromISO(iso));
export const monthName = (m: number, y = 2000) => fmt({ month: 'long' }, new Date(y, m, 1));

/** عرض التاريخ: Pazartesi 2 Kasım 2026 / الاثنين 2 نوفمبر 2026 */
export function fmtDate(iso: string, withDay = true): string {
  const d = fromISO(iso);
  const s = `${d.getDate()} ${monthName(d.getMonth())} ${d.getFullYear()}`;
  return withDay ? `${dayName(iso)} ${s}` : s;
}
export function fmtShort(iso: string): string {
  const d = fromISO(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function hijri(iso: string): string {
  try {
    const l = getLang() === 'ar' ? 'ar-SA-u-ca-islamic-umalqura-nu-latn' : 'tr-TR-u-ca-islamic-umalqura';
    return new Intl.DateTimeFormat(l, { day: 'numeric', month: 'long', year: 'numeric' }).format(fromISO(iso));
  } catch {
    return '';
  }
}

/** بداية الأسبوع: الاثنين للتركية، السبت للعربية */
export function weekStart(iso: string): string {
  const d = fromISO(iso);
  const first = getLang() === 'ar' ? 6 : 1;
  const diff = (d.getDay() - first + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toISO(d);
}
export function monthRange(iso: string): [string, string] {
  const d = fromISO(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), 1);
  const b = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [toISO(a), toISO(b)];
}
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** تخمين الصلاة الحالية حسب الوقت لتسهيل الفتح السريع */
export function guessPrayer(now = new Date()): Prayer {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 10) return 'fajr';
  if (h < 15) return 'dhuhr';
  if (h < 17.75) return 'asr';
  if (h < 19.25) return 'maghrib';
  return 'isha';
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
