import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, patch, post } from '../api';
import { useApp, useLoad } from '../state';
import { ErrorBox, Loading } from '../components/ui';
import { PlanView, type JourneyDetail } from '../components/PlanView';

export default function PlanPage() {
  const { id } = useParams();
  const { t, me, refresh } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api<JourneyDetail>(`/journeys/${id}`), [id]);
  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div>
      <h1>{t('plan_page')}</h1>
      <PlanView data={data} onChanged={reload} />
      <Updates journeyId={id!} />
      {me?.prefs.advanced && <Advanced journeyId={id!} onChanged={reload} />}
      <div className="row wrap" style={{ marginTop: 10 }}>
        {data.journey.status === 'active' && <button className="btn" onClick={async () => { await post(`/journeys/${id}/status`, { status: 'paused' }); await refresh(); reload(); }}>{t('pause_journey')}</button>}
        <button className="btn danger" onClick={async () => { await post(`/journeys/${id}/status`, { status: 'archived' }); await refresh(); nav('/'); }}>{t('archive_journey')}</button>
      </div>
    </div>
  );
}

function Updates({ journeyId }: { journeyId: string }) {
  const { t, me } = useApp();
  const { data, reload } = useLoad(() => api<{ items: any[]; following: boolean }>(`/journeys/${journeyId}/updates`), [journeyId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!data || (!data.following && !data.items.length)) return null;
  const cat = (c: string) => t(`cat_${c}` as any);
  const cls: Record<string, string> = { important: 'ok', preliminary: 'warn', unconfirmed: 'danger', opinion: 'gold', regular: '' };
  return (
    <div className="card" id="updates">
      <div className="spread">
        <h3>{t('updates')}</h3>
        {me?.ai === 'anthropic' && (
          <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await post(`/journeys/${journeyId}/updates/check`); await reload(); } catch (e: any) { setErr(e.code); } finally { setBusy(false); } }}>
            {busy ? <span className="spinner" /> : t('check_updates')}
          </button>
        )}
      </div>
      {err && <ErrorBox code={err} />}
      {data.items.length === 0 && <p className="faint">{t('nothing_yet')}</p>}
      {data.items.map((u) => (
        <div key={u.id} className="source">
          <div className="row wrap"><span className={`tag ${cls[u.category] ?? ''}`}>{cat(u.category)}</span>{u.published && <span className="faint">{u.published}</span>}</div>
          <div className="t" dir="auto"><a href={u.url} target="_blank" rel="noreferrer">{u.title}</a></div>
          <p style={{ margin: '4px 0' }}>{u.summary}</p>
          {u.relation && <p className="faint" style={{ margin: 0 }}>{u.relation}</p>}
          {u.status === 'new' && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className={`btn sm${u.recommend_add ? ' primary' : ''}`} onClick={async () => { await post(`/updates/${u.id}/add`); reload(); }}>{t('add_to_plan')}</button>
              <button className="btn sm ghost" onClick={async () => { await post(`/updates/${u.id}/dismiss`); reload(); }}>{t('dismiss')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Advanced({ journeyId, onChanged }: { journeyId: string; onChanged: () => void }) {
  const { t } = useApp();
  const { data, reload } = useLoad(() => api<{ stages: any[]; nodes: any[] }>(`/journeys/${journeyId}/advanced`), [journeyId]);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  if (!data) return <Loading />;
  const act = async (nodeId: string, b: object) => {
    await patch(`/journeys/${journeyId}/nodes/${nodeId}`, b);
    await reload();
    onChanged();
  };
  return (
    <div className="card">
      <h3>{t('advanced')}</h3>
      <p className="faint">{t('advanced_help')}</p>
      {data.stages.map((s) => (
        <details key={s.id} open>
          <summary>{s.title}</summary>
          {data.nodes.filter((n) => n.stage_id === s.id).map((n) => (
            <div key={n.id} className="list-item" style={{ opacity: n.status === 'skipped' ? 0.5 : 1 }}>
              {editing && editing.id === n.id ? (
                <div className="row">
                  <input className="input" value={editing.title} onChange={(e) => setEditing({ id: n.id, title: e.target.value })} />
                  <button className="btn sm primary" onClick={async () => { await act(n.id, { title: editing.title }); setEditing(null); }}>{t('save')}</button>
                </div>
              ) : (
                <div className="spread">
                  <span>
                    <b>{n.title}</b> <span className="faint">· {n.kind} · {n.read}/{n.lessons}</span>
                  </span>
                  <button className="btn sm ghost" onClick={() => setEditing({ id: n.id, title: n.title })}>{t('edit')}</button>
                </div>
              )}
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                {n.weight !== null && (
                  <label className="row faint" style={{ gap: 4 }}>
                    {t('weight')}
                    <select className="input" style={{ minHeight: 32, padding: '0 6px', width: 60 }} value={n.weight} onChange={(e) => act(n.id, { weight: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </label>
                )}
                <button className="btn sm" onClick={() => act(n.id, { move: 'up' })}>↑ {t('move_up')}</button>
                <button className="btn sm" onClick={() => act(n.id, { move: 'down' })}>↓ {t('move_down')}</button>
                {n.status !== 'done' && <button className="btn sm ghost" onClick={() => act(n.id, { skip: n.status !== 'skipped' })}>{n.status === 'skipped' ? t('unskip') : t('skip_node')}</button>}
              </div>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
