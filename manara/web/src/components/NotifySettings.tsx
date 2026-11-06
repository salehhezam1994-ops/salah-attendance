import { useEffect, useState } from 'react';
import { api, post } from '../api';
import { useApp, type Prefs } from '../state';
import { disablePush, enablePush, pushSupport } from '../push';

/** Notification preferences + device registration for server push. */
export function NotifySettings() {
  const { t, me, savePrefs } = useApp();
  const [devices, setDevices] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const support = pushSupport();

  const loadDevices = () => api<{ devices: number }>('/push/config').then((r) => setDevices(r.devices)).catch(() => undefined);
  useEffect(() => {
    void loadDevices();
  }, []);
  if (!me) return null;
  const n = me.prefs.notify;
  const save = (patch: Partial<Prefs['notify']>) => savePrefs({ notify: { ...n, ...patch } });

  const toggle = async (on: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      if (on) {
        const r = await enablePush();
        if (r === 'denied') return setMsg({ kind: 'warn', text: t('push_denied') });
        if (r === 'unsupported') return setMsg({ kind: 'warn', text: t('push_unsupported') });
        if (r === 'error') setMsg({ kind: 'warn', text: t('push_error') });
        if (support === 'local-only') setMsg({ kind: 'info', text: t('push_local_only') });
      } else await disablePush();
      await save({ enabled: on });
      setTimeout(loadDevices, 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="switch">
        <span>{t('notify_enable')}</span>
        <input type="checkbox" disabled={busy} checked={n.enabled} onChange={(e) => void toggle(e.target.checked)} />
      </label>
      {msg && <p className={`banner ${msg.kind}`} style={{ marginTop: 8 }}>{msg.text}</p>}
      <label className="switch"><span>{t('notify_time')}</span><input type="time" className="input" style={{ width: 130 }} value={n.dailyTime} onChange={(e) => save({ dailyTime: e.target.value })} /></label>
      <label className="switch"><span>{t('notify_reviews')}</span><input type="checkbox" checked={n.reviews} onChange={(e) => save({ reviews: e.target.checked })} /></label>
      <label className="switch"><span>{t('notify_comeback')}</span><input type="checkbox" checked={n.comeback} onChange={(e) => save({ comeback: e.target.checked })} /></label>
      <label className="switch"><span>{t('notify_updates')}</span><input type="checkbox" checked={n.updates} onChange={(e) => save({ updates: e.target.checked })} /></label>
      <div className="switch">
        <span>{t('quiet_hours')}</span>
        <span className="row" style={{ gap: 6 }}>
          <input type="time" className="input" style={{ width: 120 }} aria-label={t('quiet_from')} value={n.quietStart} onChange={(e) => save({ quietStart: e.target.value })} />
          –
          <input type="time" className="input" style={{ width: 120 }} aria-label={t('quiet_to')} value={n.quietEnd} onChange={(e) => save({ quietEnd: e.target.value })} />
        </span>
      </div>
      {n.enabled && devices !== null && (
        <div className="spread" style={{ marginTop: 10 }}>
          <span className="faint">{t('push_devices', { n: devices })}</span>
          {devices > 0 && (
            <button className="btn sm" disabled={busy} onClick={async () => { const r = await post('/push/test'); setMsg({ kind: 'info', text: t('push_test_ok', { n: r.delivered }) }); }}>
              {t('push_test')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
