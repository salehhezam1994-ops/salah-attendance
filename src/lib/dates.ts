import type { Prayer } from '../db/schema';

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

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const dayName = (iso: string) => DAY_NAMES[fromISO(iso).getDay()];
export const monthName = (m: number) => MONTHS[m];

/** عرض التاريخ: الاثنين 2 نوفمبر 2026 */
export function fmtDate(iso: string, withDay = true): string {
  const d = fromISO(iso);
  const s = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withDay ? `${DAY_NAMES[d.getDay()]} ${s}` : s;
}
export function fmtShort(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function hijri(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(fromISO(iso));
  } catch {
    return '';
  }
}

/** بداية الأسبوع (السبت) */
export function weekStart(iso: string): string {
  const d = fromISO(iso);
  const diff = (d.getDay() + 1) % 7; // السبت = 0
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
