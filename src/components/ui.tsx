import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IChevL, IChevR, ISearch } from './Icons';
import { addDays, dayName, fmtDate, hijri, todayISO } from '../lib/dates';

// ---------- Toast + Confirm ----------
interface UI {
  toast: (msg: string, err?: boolean) => void;
  confirm: (msg: string, opts?: { ok?: string; danger?: boolean; title?: string }) => Promise<boolean>;
}
const UICtx = createContext<UI>(null as never);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err?: boolean } | null>(null);
  const timer = useRef<number>();
  const [c, setC] = useState<{ msg: string; ok: string; danger?: boolean; title?: string; resolve: (v: boolean) => void } | null>(null);
  const toast = useCallback((msg: string, err?: boolean) => {
    setT({ msg, err });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), 2400);
  }, []);
  const confirm = useCallback(
    (msg: string, opts?: { ok?: string; danger?: boolean; title?: string }) =>
      new Promise<boolean>((resolve) => setC({ msg, ok: opts?.ok ?? 'تأكيد', danger: opts?.danger, title: opts?.title, resolve })),
    [],
  );
  const close = (v: boolean) => {
    c?.resolve(v);
    setC(null);
  };
  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}
      {t && <div className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>}
      {c && (
        <Sheet onClose={() => close(false)}>
          <h2>{c.title ?? 'تأكيد'}</h2>
          <p className="muted">{c.msg}</p>
          <div className="acts">
            <button className={'btn ' + (c.danger ? 'danger' : '')} onClick={() => close(true)}>
              {c.ok}
            </button>
            <button className="btn ghost" onClick={() => close(false)}>
              إلغاء
            </button>
          </div>
        </Sheet>
      )}
    </UICtx.Provider>
  );
}

// ---------- Bottom sheet ----------
export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

// ---------- Date bar ----------
export function DateBar({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  const isToday = value === todayISO();
  const lim = max ?? todayISO();
  return (
    <div className="datebar">
      <button className="ib" onClick={() => onChange(addDays(value, -1))} aria-label="اليوم السابق">
        <IChevR />
      </button>
      <div className="d">
        {dayName(value)} {fmtDate(value, false)}
        {isToday && <span className="today-tag">اليوم</span>}
        <small>{hijri(value)}</small>
        <input type="date" value={value} max={lim} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </div>
      <button className="ib" disabled={value >= lim} style={{ opacity: value >= lim ? 0.3 : 1 }} onClick={() => onChange(addDays(value, 1))} aria-label="اليوم التالي">
        <IChevL />
      </button>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <ISearch />
      <input type="search" value={value} placeholder={placeholder ?? 'بحث بالاسم أو الرقم'} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Empty({ icon, text, children }: { icon?: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <p>{text}</p>
      {children}
    </div>
  );
}

export function RateBar({ rate }: { rate: number }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
    </div>
  );
}

export const rateTone = (r: number) => (r >= 90 ? 'g' : r >= 70 ? 'y' : 'r');

/** مطابقة البحث: تجاهل الهمزات والتشكيل */
export function normAr(s: string) {
  return s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
export function matchStudent(q: string, name: string, serial: number) {
  if (!q.trim()) return true;
  const n = normAr(q);
  if (/^\d+$/.test(n)) return String(serial).startsWith(n);
  return normAr(name).includes(n);
}
