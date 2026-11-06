import { useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import { ErrorBox } from './ui';
import { MicButton } from './MicButton';

export type JourneyDetail = {
  journey: { id: string; title: string | null; topic: string; status: string; ai_mode: string };
  lang: 'ar' | 'en';
  slots: Record<string, any>;
  interview: { messages: { id: string; role: string; content: string; meta: any }[]; current: string | null; question: any; step: number } | null;
  goal: { statement: string; title: string } | null;
  plan: { title: string; overview: string; review_policy: string; updates_policy: string | null; total_lessons: number; error?: string } | null;
  stages: { id: string; idx: number; title: string; description: string; weeks: number; lessons: number; topics: { id: string; title: string; status: string }[] }[];
  keySources: { id: string; title: string; authors: string | null; year: string | null; kind: string; url: string | null; is_primary: number; verification_status: string }[];
  pendingChange: { summary: string } | null;
};

export function VerifyTag({ status }: { status: string }) {
  const { t } = useApp();
  const map: Record<string, [string, string]> = { verified: ['ok', t('verified')], located: ['gold', t('located')], unverified: ['', t('unverified')], failed: ['danger', t('failed_v')] };
  const [cls, label] = map[status] ?? ['', status];
  return <span className={`tag ${cls}`}>{label}</span>;
}

/** Plan presentation + natural-language modification. Used before start and from "My plan". */
export function PlanView({ data, onChanged }: { data: JourneyDetail; onChanged: () => void }) {
  const { t, locale } = useApp();
  const [req, setReq] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const p = data.plan;
  if (!p) return null;
  const weeks = data.slots.duration_weeks;

  const change = async () => {
    if (!req.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await post(`/journeys/${data.journey.id}/change`, { request: req });
      if (r.applied) setMsg(t('change_applied', { s: r.change.summary }));
      setReq('');
      onChanged();
    } catch (e: any) {
      setErr(e.code);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (accept: boolean) => {
    setBusy(true);
    try {
      const r = await post(`/journeys/${data.journey.id}/change/confirm`, { accept });
      if (r.applied) setMsg(t('change_applied', { s: r.change.summary }));
      onChanged();
    } catch (e: any) {
      setErr(e.code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>{p.title}</h2>
        <p className="faint">{t('plan_lessons', { n: p.total_lessons, m: data.slots.minutes_per_day, w: weeks })}</p>
        <p>{p.overview}</p>
      </div>
      <div className="card">
        <h3>{t('plan_stages')}</h3>
        <ol style={{ paddingInlineStart: 20, margin: 0 }}>
          {data.stages.map((s) => (
            <li key={s.id} style={{ marginBottom: 12 }}>
              <b>{s.title}</b> <span className="faint">· {s.lessons} · {locale === 'ar' ? `${s.weeks} أسابيع` : `${s.weeks} wk`}</span>
              <div className="muted" style={{ fontSize: '.95rem' }}>{s.description}</div>
              {s.topics.length > 0 && <div className="chips" style={{ marginTop: 6 }}>{s.topics.slice(0, 6).map((tp) => <span key={tp.id} className="tag">{tp.title}</span>)}</div>}
            </li>
          ))}
        </ol>
      </div>
      {data.keySources.length > 0 && (
        <div className="card">
          <h3>{t('plan_sources')}</h3>
          {data.keySources.map((s) => (
            <div key={s.id} className="source">
              <div className="t">{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</div>
              <div className="row wrap faint">
                {s.authors && <span>{s.authors}</span>}
                {s.year && <span>{s.year}</span>}
                {s.is_primary ? <span className="tag gold">{t('primary')}</span> : null}
                <VerifyTag status={s.verification_status} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card soft">
        <p><b>{t('plan_review')}:</b> {p.review_policy}</p>
        {data.slots.follow_updates && p.updates_policy && <p style={{ margin: 0 }}><b>{t('plan_updates')}:</b> {p.updates_policy}</p>}
      </div>
      {data.pendingChange && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <p><b>{t('confirm_change_q')}</b> {data.pendingChange.summary}</p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => confirm(true)}>{t('confirm')}</button>
            <button className="btn" disabled={busy} onClick={() => confirm(false)}>{t('cancel')}</button>
          </div>
        </div>
      )}
      <div className="card">
        <h3>{t('plan_change')}</h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <textarea className="input" rows={2} placeholder={t('plan_change_ph')} value={req} onChange={(e) => setReq(e.target.value)} />
          <MicButton onText={(x) => setReq((r) => (r ? r + ' ' : '') + x)} />
        </div>
        <button className="btn" style={{ marginTop: 8 }} disabled={busy || !req.trim()} onClick={change}>{busy ? <span className="spinner" /> : t('send')}</button>
        {msg && <p className="banner info" style={{ marginTop: 10 }}>{msg}</p>}
        {err && <ErrorBox code={err} />}
      </div>
    </div>
  );
}
