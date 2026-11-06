import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api';
import { useApp, useLoad } from '../state';
import { AiBanner, ErrorBox, Loading } from '../components/ui';
import { PlanView, type JourneyDetail } from '../components/PlanView';
import { MicButton } from '../components/MicButton';
import { IBack, IQuestion, ISend } from '../components/Icons';

type Question = { slot: string; text: string; options: { value: string; label: string }[]; free: boolean; skippable: boolean; step: number; total: number };

/** The whole guided setup: interview → goal confirmation → planning → plan approval. */
export default function Setup() {
  const { id } = useParams();
  const { t, refresh } = useApp();
  const nav = useNavigate();
  const { data, error, reload, setData } = useLoad(() => api<JourneyDetail>(`/journeys/${id}`), [id]);
  const status = data?.journey.status;

  // Poll while planning.
  useEffect(() => {
    if (status !== 'planning') return;
    const timer = window.setInterval(async () => {
      try {
        const d = await api<JourneyDetail>(`/journeys/${id}`);
        if (d.journey.status !== 'planning') setData(d);
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [status, id, setData]);

  useEffect(() => {
    if (status === 'active' || status === 'paused') nav(`/j/${id}`, { replace: true });
  }, [status, id, nav]);

  if (error) return <div className="welcome"><ErrorBox code={error} onRetry={reload} /></div>;
  if (!data) return <div className="welcome"><Loading /></div>;

  return (
    <div className="main" style={{ paddingBottom: 40 }}>
      <div className="topbar">
        <img src="/icon.svg" alt="" width={32} height={32} />
        <div className="title"><b>{data.goal?.title || data.journey.topic || t('app')}</b></div>
      </div>
      <AiBanner />
      {(status === 'interviewing' || status === 'confirming') && <Interview data={data} reload={reload} />}
      {status === 'planning' && <Planning />}
      {status === 'plan_failed' && (
        <div className="card">
          <ErrorBox code={data.plan?.error ?? 'default'} />
          <button className="btn primary" onClick={async () => { await post(`/journeys/${id}/goal`, { accept: true }); reload(); }}>{t('retry')}</button>
        </div>
      )}
      {status === 'proposed' && (
        <>
          <PlanView data={data} onChanged={reload} />
          <div className="card hero">
            <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>{t('plan_question')}</p>
            <button
              className="btn primary block"
              onClick={async () => {
                await post(`/journeys/${id}/approve`);
                await refresh();
                nav(`/j/${id}`, { replace: true });
              }}
            >
              {t('plan_start')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Interview({ data, reload }: { data: JourneyDetail; reload: () => Promise<void> }) {
  const { t, locale } = useApp();
  const id = data.journey.id;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgs = data.interview?.messages ?? [];
  const lastQ: Question | null = [...msgs].reverse().find((m) => m.meta?.question)?.meta.question ?? null;
  const confirming = data.journey.status === 'confirming';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (!busy) inputRef.current?.focus();
  }, [msgs.length, busy]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setErr(e.code ?? 'default');
    } finally {
      setBusy(false);
    }
  };
  const answer = (choice?: string, label?: string) =>
    act(async () => {
      await post(`/journeys/${id}/interview/answer`, { text: choice ? (label ?? '') : text, choice });
      setText('');
    });

  return (
    <div>
      {lastQ && !confirming && (
        <div style={{ marginBottom: 14 }}>
          <div className="progress-dots" aria-label={t('step_of', { n: lastQ.step, t: lastQ.total })}>
            {Array.from({ length: lastQ.total }).map((_, i) => <i key={i} className={i < lastQ.step - 1 ? 'on' : ''} />)}
          </div>
        </div>
      )}
      <div className="chat" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role === 'user' ? 'me' : 'bot'}${m.meta?.help ? ' note' : ''}`}>{m.content}</div>
        ))}
        {busy && <div className="bubble bot"><span className="typing"><i /><i /><i /></span></div>}
        <div ref={endRef} />
      </div>

      {err && <ErrorBox code={err} />}

      {confirming ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{t('goal_title')}</h3>
          {!editGoal ? (
            <div className="row wrap">
              <button className="btn primary" disabled={busy} onClick={() => act(() => post(`/journeys/${id}/goal`, { accept: true }))}>{t('goal_yes')}</button>
              <button className="btn" disabled={busy} onClick={() => setEditGoal(true)}>{t('goal_edit')}</button>
              <button className="btn ghost" disabled={busy} onClick={() => act(() => post(`/journeys/${id}/interview/back`))}>{t('prev_question')}</button>
            </div>
          ) : (
            <div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <textarea ref={inputRef} className="input" rows={2} placeholder={t('goal_edit_ph')} value={text} onChange={(e) => setText(e.target.value)} />
                <MicButton onText={(x) => setText((r) => (r ? r + ' ' : '') + x)} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn primary" disabled={busy || !text.trim()} onClick={() => act(async () => { await post(`/journeys/${id}/goal`, { accept: false, correction: text }); setText(''); setEditGoal(false); })}>{t('send')}</button>
                <button className="btn ghost" onClick={() => setEditGoal(false)}>{t('cancel')}</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        lastQ && (
          <div style={{ marginTop: 16 }}>
            {lastQ.options.length > 0 && (
              <div className="chips" style={{ marginBottom: 10 }}>
                {lastQ.options.map((o) => (
                  <button key={o.value} className="chip" disabled={busy} onClick={() => answer(o.value, o.label)}>{o.label}</button>
                ))}
              </div>
            )}
            {(lastQ.free || lastQ.options.length === 0) && (
              <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) void answer(); }}>
                <textarea
                  ref={inputRef}
                  className="input"
                  rows={1}
                  placeholder={t('type_answer')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) void answer(); } }}
                  aria-label={lastQ.text}
                />
                <MicButton onText={(x) => setText((r) => (r ? r + ' ' : '') + x)} />
                <button className="icon-btn" style={{ background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }} disabled={busy || !text.trim()} aria-label={t('send')}>
                  <ISend style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} />
                </button>
              </form>
            )}
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button className="btn sm ghost" disabled={busy} onClick={() => act(() => post(`/journeys/${id}/interview/help`))}><IQuestion /> {t('didnt_understand')}</button>
              {lastQ.step > 1 && <button className="btn sm ghost" disabled={busy} onClick={() => act(() => post(`/journeys/${id}/interview/back`))}><IBack style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} /> {t('prev_question')}</button>}
              {lastQ.skippable && <button className="btn sm ghost" disabled={busy} onClick={() => answer(lastQ.options[0]?.value, lastQ.options[0]?.label)}>{t('skip')}</button>}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Planning() {
  const { t } = useApp();
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setI((x) => Math.min(x + 1, t.d.planning_steps.length - 1)), 6000);
    return () => window.clearInterval(timer);
  }, [t]);
  return (
    <div className="card" aria-live="polite">
      <h2 className="row"><span className="spinner" /> {t('planning')}</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {t.d.planning_steps.map((s, k) => (
          <li key={s} style={{ opacity: k <= i ? 1 : 0.4, marginBottom: 6 }}>{k < i ? '✓' : k === i ? '•' : '○'} {s}</li>
        ))}
      </ul>
      <p className="faint">{t('planning_note')}</p>
    </div>
  );
}
