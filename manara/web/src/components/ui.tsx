import { useEffect, type ReactNode } from 'react';
import { useApp } from '../state';

export function Loading({ lines = 3, label }: { lines?: number; label?: string }) {
  const { t } = useApp();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label ?? t('loading')}</span>
      {label && (
        <p className="row muted">
          <span className="spinner" /> {label}
        </p>
      )}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ code, onRetry }: { code: string; onRetry?: () => void }) {
  const { t } = useApp();
  return (
    <div className="banner danger" role="alert">
      <p style={{ margin: 0 }}>{t.err(code)}</p>
      {onRetry && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={onRetry}>
          {t('retry')}
        </button>
      )}
    </div>
  );
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

export function Ring({ percent }: { percent: number }) {
  return (
    <div className="ring" style={{ ['--p' as string]: percent }} aria-label={`${percent}%`}>
      <span>{percent}%</span>
    </div>
  );
}

export function Bar({ percent }: { percent: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(2, percent)}%` }} />
    </div>
  );
}

export function AiBanner() {
  const { me, t } = useApp();
  if (!me || me.ai === 'anthropic') return null;
  return <div className={`banner ${me.ai === 'off' ? 'warn' : 'info'}`}>{me.ai === 'off' ? t('ai_off') : t('ai_demo')}</div>;
}

export const fmtDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar' : 'en', { day: 'numeric', month: 'long' });
