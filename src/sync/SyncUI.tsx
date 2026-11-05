import { useEffect, useState } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { createSchool, formatCode, getSyncState, joinSchool, leaveSchool, subscribeSync, syncAvailable, push, type SyncState } from './sync';
import { useUI } from '../components/ui';
import { t, locale } from '../i18n';

export function useSyncState(): SyncState {
  const [s, setS] = useState(getSyncState());
  useEffect(() => {
    const un = subscribeSync(setS);
    return () => {
      un();
    };
  }, []);
  return s;
}

const ago = (ts: number | null) => {
  if (!ts) return '—';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('ago_now');
  if (m < 60) return t('ago_min', { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? t('ago_hour', { n: h }) : new Date(ts).toLocaleDateString(locale());
};

/** مؤشر صغير في الشريط العلوي */
export function SyncDot() {
  const s = useSyncState();
  if (!s.enabled) return null;
  const ok = s.online && s.pending === 0 && !s.error;
  const title = !s.online ? t('offline_long') : s.pending ? t('pending', { n: s.pending }) : t('dot_synced');
  return (
    <span title={title} aria-label={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, background: 'rgba(255,255,255,.15)', borderRadius: 999, padding: s.pending ? '3px 8px' : '6px', flexShrink: 0 }}>
      <i style={{ width: 8, height: 8, borderRadius: 9, background: ok ? '#4ade80' : '#fbbf24', display: 'inline-block' }} />
      {s.pending > 0 ? s.pending : ''}
    </span>
  );
}

/** بطاقة المزامنة في صفحة «المزيد» */
export function SyncCard({ isAdmin }: { isAdmin: boolean }) {
  const s = useSyncState();
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  if (!syncAvailable()) return null;

  const share = async () => {
    const text = t('share_text', { code: formatCode(s.school!) });
    if (Capacitor.isNativePlatform()) await Share.share({ text, dialogTitle: t('share_title') });
    else {
      await navigator.clipboard?.writeText(formatCode(s.school!));
      ui.toast(t('code_copied'));
    }
  };

  return (
    <div className="card">
      <h3>{t('sync_title')}</h3>
      {!s.enabled ? (
        isAdmin ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              {t('sync_off_hint')}
            </p>
            <button
              className="btn block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await createSchool();
                  ui.toast(t('sync_enabled'));
                } catch (e) {
                  ui.toast(t('sync_enable_failed', { e: (e as Error).message }), true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? t('uploading') : t('enable_sync')}
            </button>
          </>
        ) : (
          <p className="small muted">{t('sync_off_sup')}</p>
        )
      ) : (
        <>
          {isAdmin && (
            <>
              <p className="small muted" style={{ margin: '0 0 6px' }}>
                {t('code_hint')}
              </p>
              <div className="row">
                <b dir="ltr" className="grow" style={{ fontSize: 22, letterSpacing: 2, background: 'var(--brand-soft)', color: 'var(--brand)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                  {formatCode(s.school!)}
                </b>
                <button className="btn sm" onClick={share}>
                  {t('share')}
                </button>
              </div>
            </>
          )}
          <div className="small" style={{ marginTop: 10, lineHeight: 1.9 }}>
            <div>
              {t('status')}: <b style={{ color: s.online ? 'var(--ok)' : 'var(--warn)' }}>{s.online ? t('online') : t('offline_long')}</b>
            </div>
            <div>{t('pending', { n: s.pending })}</div>
            <div>{t('last_sync', { v: ago(s.lastSync) })}</div>
            {s.error && <div style={{ color: 'var(--bad)' }}>{t('error_x', { e: s.error })}</div>}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm ghost grow" onClick={() => void push()}>
              {t('sync_now')}
            </button>
            <button
              className="btn sm ghost grow"
              onClick={async () => {
                if (await ui.confirm(t('confirm_stop_sync'), { ok: t('stop'), danger: true })) await leaveSchool();
              }}
            >
              {t('stop_sync')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** انضمام جهاز مشرف إلى مدرسة موجودة */
export function JoinSchool({ onCancel }: { onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const s = useSyncState();
  return (
    <div className="card">
      <h3>{t('join_title')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('join_hint')}
      </p>
      <input dir="ltr" value={code} onChange={(e) => (setCode(e.target.value), setErr(''))} placeholder="XXXX-XXXX-XXXX" style={{ textAlign: 'center', fontSize: 20, letterSpacing: 2 }} />
      {err && <p className="small" style={{ color: 'var(--bad)' }}>{err}</p>}
      <div className="sp" />
      <button
        className="btn block"
        disabled={s.loading || code.replace(/[^A-Za-z0-9]/g, '').length < 8}
        onClick={async () => {
          try {
            await joinSchool(code);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {s.loading ? t('downloading') : t('join')}
      </button>
      <div className="sp" />
      <button className="btn block ghost" onClick={onCancel} disabled={s.loading}>
        {t('back')}
      </button>
    </div>
  );
}
