import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, del, patch } from '../api';
import { useApp, type Prefs as P } from '../state';
import { ErrorBox, fmtDate } from '../components/ui';
import { IBack } from '../components/Icons';
import { NotifySettings } from '../components/NotifySettings';

function ListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  const { t } = useApp();
  const [v, setV] = useState('');
  return (
    <div className="field">
      <span>{label}</span>
      <div className="chips" style={{ marginBottom: 6 }}>
        {items.map((x) => (
          <button key={x} className="chip on" onClick={() => onChange(items.filter((y) => y !== x))} aria-label={`${t('delete')} ${x}`}>{x} ×</button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onChange([...items, v.trim()]); setV(''); } }}>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn sm">{t('add')}</button>
      </form>
    </div>
  );
}

export default function Prefs() {
  const { t, me, savePrefs, locale, refresh } = useApp();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [journey, setJourney] = useState<any | null>(null);
  const active = me?.journeys.find((j) => j.status === 'active' || j.status === 'paused');

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith(locale)));
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [locale]);
  useEffect(() => {
    if (active) api(`/journeys/${active.id}`).then(setJourney).catch(() => undefined);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return null;
  const p = me.prefs;
  const save = async (patchP: Partial<P>) => {
    setErr(null);
    try {
      await savePrefs(patchP);
    } catch (e: any) {
      setErr(e.code);
    }
  };
  const setJourneySetting = async (s: Record<string, unknown>) => {
    setErr(null);
    try {
      await patch(`/journeys/${active!.id}/settings`, s);
      setJourney(await api(`/journeys/${active!.id}`));
    } catch (e: any) {
      setErr(e.code);
    }
  };
  const sub = me.subscription;

  return (
    <div className="main">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label={t('back')}><IBack style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} /></button>
        <h1 className="title" style={{ margin: 0 }}>{t('prefs')}</h1>
      </div>
      {err && <ErrorBox code={err} />}

      {me.user.is_guest ? (
        <div className="card soft spread"><span>{t('guest_note')}</span><Link to="/account" className="btn sm primary">{t('create_account')}</Link></div>
      ) : null}

      {journey && (
        <div className="card">
          <h3>{t('pref_journey')}: {journey.journey.title}</h3>
          <label className="field"><span>{locale === 'ar' ? 'الدقائق يوميًا' : 'Minutes a day'}</span>
            <select className="input" value={journey.slots.minutes_per_day} onChange={(e) => setJourneySetting({ minutes_per_day: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="field"><span>{locale === 'ar' ? 'مدة الرحلة (أسابيع)' : 'Journey length (weeks)'}</span>
            <select className="input" value={journey.slots.duration_weeks} onChange={(e) => setJourneySetting({ duration_weeks: Number(e.target.value) })}>
              {[...new Set([4, 8, 12, 26, 39, 52, 78, 104, journey.slots.duration_weeks])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('pref_detail')}</span>
            <select className="input" value={journey.slots.detail} onChange={(e) => setJourneySetting({ detail: e.target.value })}>
              <option value="brief">{locale === 'ar' ? 'مختصر جدًا' : 'Very brief'}</option>
              <option value="medium">{locale === 'ar' ? 'متوسط' : 'Medium'}</option>
              <option value="detailed">{locale === 'ar' ? 'مفصل' : 'Detailed'}</option>
            </select>
          </label>
          <p className="faint">{locale === 'ar' ? 'لتغييرات أعمق (محاور، تركيز، مصادر) اكتب طلبك بلغتك في صفحة «خطتي».' : 'For deeper changes (topics, focus, sources) describe them on "My plan".'}</p>
          <Link className="btn sm" to={`/j/${active!.id}/plan`}>{t('plan_page')}</Link>
        </div>
      )}

      <div className="card">
        <label className="field"><span>{t('pref_language')}</span>
          <select className="input" value={p.locale} onChange={(e) => save({ locale: e.target.value as 'ar' | 'en' })}>
            <option value="ar">العربية</option><option value="en">English</option>
          </select>
        </label>
        <label className="field"><span>{t('pref_detail')}</span>
          <select className="input" value={p.detail} onChange={(e) => save({ detail: e.target.value as P['detail'] })}>
            <option value="brief">{locale === 'ar' ? 'مختصر جدًا' : 'Very brief'}</option><option value="medium">{locale === 'ar' ? 'متوسط' : 'Medium'}</option><option value="detailed">{locale === 'ar' ? 'مفصل' : 'Detailed'}</option>
          </select>
        </label>
        <label className="field"><span>{t('pref_doc')}</span>
          <select className="input" value={p.documentation} onChange={(e) => save({ documentation: e.target.value as P['documentation'] })}>
            <option value="standard">{t('doc_standard')}</option><option value="strict">{t('doc_strict')}</option>
          </select>
        </label>
        <label className="field"><span>{t('pref_theme')}</span>
          <select className="input" value={p.theme} onChange={(e) => save({ theme: e.target.value as P['theme'] })}>
            <option value="system">{t('theme_system')}</option><option value="light">{t('theme_light')}</option><option value="dark">{t('theme_dark')}</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h3>{t('pref_voice')}</h3>
        <label className="field"><span>{t('pref_rate')}: {p.voice.rate.toFixed(2)}×</span>
          <input type="range" min={0.6} max={1.6} step={0.05} value={p.voice.rate} onChange={(e) => save({ voice: { ...p.voice, rate: Number(e.target.value) } })} style={{ width: '100%' }} />
        </label>
        {voices.length > 0 && (
          <label className="field"><span>{t('pref_voice')}</span>
            <select className="input" value={p.voice.voiceName ?? ''} onChange={(e) => save({ voice: { ...p.voice, voiceName: e.target.value || null } })}>
              <option value="">—</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </label>
        )}
        <label className="switch"><span>{t('pref_autoread')}</span><input type="checkbox" checked={p.voice.autoRead} onChange={(e) => save({ voice: { ...p.voice, autoRead: e.target.checked } })} /></label>
      </div>

      <div className="card">
        <h3>{t('pref_notify')}</h3>
        <NotifySettings />
        <p className="faint" style={{ marginTop: 8 }}>{t('notify_note')}</p>
      </div>

      <div className="card">
        <ListEditor label={t('pref_interests')} items={p.interests} onChange={(v) => save({ interests: v })} />
        <ListEditor label={t('pref_avoid')} items={p.avoid} onChange={(v) => save({ avoid: v })} />
        <ListEditor label={t('pref_sources')} items={p.preferredSources} onChange={(v) => save({ preferredSources: v })} />
        <ListEditor label={t('pref_commands')} items={p.savedCommands} onChange={(v) => save({ savedCommands: v })} />
        <label className="switch"><span>{t('pref_advanced')}</span><input type="checkbox" checked={p.advanced} onChange={(e) => save({ advanced: e.target.checked })} /></label>
      </div>

      <div className="card">
        <h3>{t('subscription')}</h3>
        <p><b>{sub.planInfo.label[locale]}</b>{sub.ends_at && sub.plan === 'trial' ? <span className="faint"> · {t('trial_ends', { d: fmtDate(sub.ends_at, locale) })}</span> : null}</p>
        <div className="faint">{t('usage')}</div>
        {(['lessons', 'tutor', 'research', 'plans'] as const).map((m) => (
          <div key={m} className="spread"><span>{t(`plan_${m}_u` as any)}</span><span>{sub.usage[m]} / {sub.planInfo.limits[m]}</span></div>
        ))}
      </div>

      <div className="card">
        <h3>{t('privacy')}</h3>
        <p className="muted">{t('privacy_text')}</p>
        <div className="row wrap">
          <a className="btn" href="/api/me/export" download>{t('export')}</a>
          <button className="btn danger" onClick={async () => {
            if (!window.confirm(t('delete_confirm'))) return;
            await del('/me');
            try { await caches.delete('manara-data-v1'); } catch { /* ignore */ }
            await refresh();
            nav('/welcome');
          }}>{t('delete_account')}</button>
        </div>
      </div>
    </div>
  );
}
