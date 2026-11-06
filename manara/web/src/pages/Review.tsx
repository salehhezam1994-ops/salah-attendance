import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api';
import { useApp, useLoad } from '../state';
import { ErrorBox, Loading, fmtDate } from '../components/ui';

type Item = { id: string; question: string; answer: string; lesson_title?: string };

/** Recall cards: answer (optional) → reveal → self-rate. Scheduling happens on the server. */
export function QuizCards({ items, onDone }: { items: Item[]; onDone?: () => void }) {
  const { t } = useApp();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [mine, setMine] = useState('');
  const [session, setSession] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  if (!items.length) return <p className="muted">{t('no_reviews')}</p>;
  if (i >= items.length)
    return (
      <div className="empty">
        <p style={{ fontSize: '1.2rem' }}>✓ {t('review_done')}</p>
        <p className="muted">{score} / {items.length}</p>
        {onDone && <button className="btn" onClick={onDone}>{t('close')}</button>}
      </div>
    );
  const it = items[i];
  const rate = async (result: 'remembered' | 'partial' | 'forgot') => {
    const r = await post(`/reviews/${it.id}`, { result, answer: mine || null, sessionId: session });
    setSession(r.sessionId);
    if (result === 'remembered') setScore((s) => s + 1);
    setShown(false);
    setMine('');
    setI(i + 1);
  };
  return (
    <div>
      <div className="faint">{i + 1} / {items.length}{it.lesson_title ? ` · ${it.lesson_title}` : ''}</div>
      <p style={{ fontSize: '1.15rem', fontWeight: 700, margin: '8px 0 12px' }}>{it.question}</p>
      {!shown ? (
        <>
          <textarea className="input" rows={2} placeholder={t('your_answer')} value={mine} onChange={(e) => setMine(e.target.value)} />
          <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => setShown(true)}>{t('show_answer')}</button>
        </>
      ) : (
        <>
          <div className="card soft">{it.answer}</div>
          <div className="row wrap">
            <button className="btn primary" onClick={() => rate('remembered')}>{t('remembered')}</button>
            <button className="btn" onClick={() => rate('partial')}>{t('partial')}</button>
            <button className="btn" onClick={() => rate('forgot')}>{t('forgot')}</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Review() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const { data, error, reload } = useLoad(() => api<{ items: Item[]; nextDue: string | null }>(`/journeys/${id}/reviews/due`), [id]);
  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div>
      <h1>{t('review')}</h1>
      <div className="card">
        {data.items.length ? (
          <QuizCards items={data.items} />
        ) : (
          <div className="empty">
            <p>{t('no_reviews')}</p>
            {data.nextDue && <p className="faint">{t('next_review_at', { d: fmtDate(data.nextDue, locale) })}</p>}
            <Link to={`/j/${id}`} className="btn">{t('nav_home')}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
