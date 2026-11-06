import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api';
import { useApp, useLoad } from '../state';
import { Bar, ErrorBox, Loading, Ring } from '../components/ui';

type P = {
  total: number; read: number; percent: number; minutes: number; currentStage: string | null;
  stages: { id: string; title: string; total: number; read: number; percent: number }[];
  reviews: { total: number; remembered: number }; weak: { title: string }[]; strong: string[]; concepts: number; sources: number; activeDays: number;
};

export default function Progress() {
  const { id } = useParams();
  const { t } = useApp();
  const { data, error, reload } = useLoad(() => api<P>(`/journeys/${id}/progress`), [id]);
  const [syn, setSyn] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const synthesize = async () => {
    setBusy(true);
    setErr(null);
    try {
      setSyn(await post(`/journeys/${id}/synthesis`));
    } catch (e: any) {
      setErr(e.code);
    } finally {
      setBusy(false);
    }
  };
  const stat = (n: number | string, label: string) => (
    <div className="card soft" style={{ textAlign: 'center', marginBottom: 0 }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--primary)' }}>{n}</div>
      <div className="faint">{label}</div>
    </div>
  );

  return (
    <div>
      <h1>{t('progress_title')}</h1>
      <div className="card row">
        <Ring percent={data.percent} />
        <div>
          <div className="faint">{t('completion')}</div>
          <b>{t('position', { n: data.read, t: data.total })}</b>
          <div className="faint">{t('current_stage')}: {data.currentStage ?? '—'}</div>
        </div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: 14 }}>
        {stat(data.minutes, t('learn_minutes'))}
        {stat(data.concepts, t('concepts_n'))}
        {stat(data.sources, t('sources_n'))}
        {stat(data.activeDays, t('active_days'))}
      </div>
      <div className="card">
        <h3>{t('plan_stages')}</h3>
        {data.stages.map((s) => (
          <div key={s.id} style={{ marginBottom: 10 }}>
            <div className="spread"><span>{s.title}</span><span className="faint">{s.read}/{s.total}</span></div>
            <Bar percent={s.percent} />
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="card">
          <h3>{t('strong')}</h3>
          {data.strong.length ? data.strong.map((s) => <div key={s}>✓ {s}</div>) : <p className="faint">{t('nothing_yet')}</p>}
        </div>
        <div className="card">
          <h3>{t('weak')}</h3>
          {data.weak.length ? data.weak.map((w) => <div key={w.title}>• {w.title}</div>) : <p className="faint">{t('nothing_yet')}</p>}
          <Link to={`/j/${id}/review`} className="btn sm" style={{ marginTop: 8 }}>{t('review')}</Link>
        </div>
      </div>
      <div className="card">
        <h3>{t('synthesis')}</h3>
        {!syn && <button className="btn primary" disabled={busy || data.read === 0} onClick={synthesize}>{busy ? <span className="spinner" /> : t('synthesis_btn')}</button>}
        {err && <ErrorBox code={err} />}
        {syn && (
          <div className="stack">
            <p>{syn.overview}</p>
            <h3>{t('syn_ideas')}</h3>
            <ul>{syn.key_ideas.map((k: string) => <li key={k}>{k}</li>)}</ul>
            <h3>{t('syn_evolution')}</h3>
            <p>{syn.evolution}</p>
            {syn.connections.length > 0 && (<><h3>{t('syn_connections')}</h3><ul>{syn.connections.map((k: string) => <li key={k}>{k}</li>)}</ul></>)}
            {syn.gaps.length > 0 && (<><h3>{t('syn_gaps')}</h3><ul>{syn.gaps.map((k: string) => <li key={k}>{k}</li>)}</ul></>)}
            {syn.next_focus && (<><h3>{t('syn_next')}</h3><p>{syn.next_focus}</p></>)}
          </div>
        )}
      </div>
    </div>
  );
}
