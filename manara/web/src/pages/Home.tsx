import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api';
import { useApp, useLoad } from '../state';
import { AiBanner, Bar, ErrorBox, Loading, Ring, fmtDate } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { IChat, IUpdates } from '../components/Icons';

type HomeData = {
  today: { id: string; title: string; key_question: string | null; status: string; minutes: number | null; error: string | null; content_mode: string | null } | null;
  progress: { total: number; read: number; percent: number; currentStage: string | null; stages: { title: string; percent: number }[] };
  welcomeBack: { days: number; lastTopic: string | null } | null;
  recent: { id: string; title: string; read_at: string }[];
  reviewsDue: number;
  nextReview: string | null;
  updates: number;
  status: string;
};

export default function Home() {
  const { id } = useParams();
  const { t, me, locale } = useApp();
  const nav = useNavigate();
  const { data, error, reload, setData } = useLoad(() => api<HomeData>(`/journeys/${id}/home`), [id]);
  const journey = me?.journeys.find((j) => j.id === id);

  // While the dose is being prepared, refresh quietly.
  useEffect(() => {
    if (data?.today?.status !== 'generating') return;
    const timer = window.setInterval(async () => {
      try {
        const d = await api<HomeData>(`/journeys/${id}/home`);
        if (d.today?.status !== 'generating') setData(d);
      } catch {
        /* retry next tick */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [data?.today?.status, id, setData]);

  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} />;
  const today = data.today;
  const name = me?.user.name;

  return (
    <div>
      <TopBar journeyId={id!} title={journey?.title || journey?.topic || ''} subtitle={name ? `${t('hello')}، ${name}` : t('hello')} />
      <AiBanner />

      {data.status === 'paused' && (
        <div className="card soft spread">
          <span>{t('paused')}</span>
          <button className="btn sm primary" onClick={async () => { await post(`/journeys/${id}/status`, { status: 'active' }); reload(); }}>{t('resume')}</button>
        </div>
      )}

      {data.welcomeBack && data.welcomeBack.lastTopic && (
        <div className="card soft">
          <p>{t('welcome_back', { topic: data.welcomeBack.lastTopic })}</p>
          <div className="row wrap">
            {today && <Link className="btn primary sm" to={`/j/${id}/lesson/${today.id}`}>{t('continue_plan')}</Link>}
            <Link className="btn sm" to={`/j/${id}/review`}>{t('review_first')}</Link>
          </div>
        </div>
      )}

      <section className="card hero" aria-label={t('open_lesson')}>
        {!today ? (
          <p>{t('plan_done')}</p>
        ) : today.status === 'failed' ? (
          <>
            <h2>{today.title}</h2>
            <p>{t.err(today.error ?? 'default')}</p>
            <button className="btn primary" onClick={async () => { await post(`/lessons/${today.id}/generate`); reload(); }}>{t('retry')}</button>
          </>
        ) : today.status === 'generating' ? (
          <>
            <h2>{today.title}</h2>
            <p className="row"><span className="spinner" style={{ borderTopColor: '#fff' }} /> {t('preparing_lesson')}</p>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 6 }}>{t('todays_dose', { m: today.minutes ?? 5 })}</p>
            <h2 style={{ fontSize: '1.4rem' }}>{today.title}</h2>
            {today.key_question && <p style={{ opacity: 0.92 }}>{today.key_question}</p>}
            <button className="btn primary block" onClick={() => nav(`/j/${id}/lesson/${today.id}`)}>{t('open_lesson')}</button>
          </>
        )}
      </section>

      <div className="card">
        <div className="row">
          <Ring percent={data.progress.percent} />
          <div style={{ flex: 1 }}>
            <div className="faint">{t('current_stage')}</div>
            <b>{data.progress.currentStage ?? '—'}</b>
            <div className="faint">{t('position', { n: data.progress.read, t: data.progress.total })}</div>
          </div>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {data.progress.stages.map((s) => (
            <div key={s.title}>
              <div className="spread faint"><span>{s.title}</span><span>{s.percent}%</span></div>
              <Bar percent={s.percent} />
            </div>
          ))}
        </div>
        <Link to={`/j/${id}/map`} className="btn sm" style={{ marginTop: 12 }}>{t('map_title')}</Link>
      </div>

      {data.reviewsDue > 0 ? (
        <div className="card spread">
          <span>{t('reviews_due', { n: data.reviewsDue })}</span>
          <Link to={`/j/${id}/review`} className="btn sm gold">{t('start_review')}</Link>
        </div>
      ) : data.nextReview ? (
        <p className="faint" style={{ textAlign: 'center' }}>{t('next_review_at', { d: fmtDate(data.nextReview, locale) })}</p>
      ) : null}

      {data.updates > 0 && (
        <Link to={`/j/${id}/plan#updates`} className="card spread" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="row"><IUpdates style={{ width: 22 }} /> {t('updates_new', { n: data.updates })}</span>
        </Link>
      )}

      {data.recent.length > 0 && (
        <div className="card">
          <h3>{t('recent')}</h3>
          {data.recent.map((r) => (
            <Link key={r.id} className="list-item" to={`/j/${id}/lesson/${r.id}`}>{r.title}</Link>
          ))}
        </div>
      )}

      <Link to={`/j/${id}/companion`} className="fab" aria-label={t('companion_title')}><IChat /></Link>
    </div>
  );
}
