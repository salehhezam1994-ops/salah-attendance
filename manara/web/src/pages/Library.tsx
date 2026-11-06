import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, del, put } from '../api';
import { useApp, useLoad } from '../state';
import { ErrorBox, Loading, fmtDate } from '../components/ui';
import { VerifyTag } from '../components/PlanView';
import { ISearch } from '../components/Icons';

type Lib = {
  saved: { id: string; title: string; key_question: string | null }[];
  read: { id: string; title: string; key_question: string | null; read_at: string; saved: number }[];
  concepts: { id: string; term: string; definition: string; lesson_id: string; lesson_title: string }[];
  notes: { id: string; body: string; lesson_id: string | null; lesson_title: string | null; created_at: string }[];
  sources: { id: string; title: string; authors: string | null; year: string | null; kind: string; url: string | null; is_primary: number; verification_status: string; uses: number }[];
};
type Tab = 'saved' | 'read' | 'concepts' | 'notes' | 'sources';

export default function Library() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const { data, error, reload } = useLoad(() => api<Lib>(`/journeys/${id}/library`), [id]);
  const [tab, setTab] = useState<Tab>('read');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('all');

  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const h = setTimeout(() => api(`/search?q=${encodeURIComponent(q)}&journeyId=${id}`).then(setResults).catch(() => undefined), 300);
    return () => clearTimeout(h);
  }, [q, id]);

  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const tabs: [Tab, string, number][] = [
    ['read', t('tab_read'), data.read.length],
    ['saved', t('tab_saved'), data.saved.length],
    ['concepts', t('tab_concepts'), data.concepts.length],
    ['notes', t('tab_notes'), data.notes.length],
    ['sources', t('tab_sources'), data.sources.length],
  ];
  const kinds = [...new Set(data.sources.map((s) => s.kind))];
  const L = (lid: string) => `/j/${id}/lesson/${lid}`;

  return (
    <div>
      <h1>{t('library_title')}</h1>
      <label className="row card" style={{ padding: '6px 12px' }}>
        <ISearch style={{ width: 20, color: 'var(--ink-3)' }} />
        <input className="input" style={{ border: 0, minHeight: 40, padding: 4 }} placeholder={t('search_knowledge')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
      </label>

      {results ? (
        <div className="card">
          {results.lessons.map((l: any) => <Link key={l.id} className="list-item" to={L(l.id)}><b>{l.title}</b><div className="faint">{l.key_question}</div></Link>)}
          {results.concepts.map((c: any) => <Link key={c.id} className="list-item" to={L(c.lesson_id)}><b>{c.term}</b>: {c.definition}</Link>)}
          {results.notes.map((n: any) => <div key={n.id} className="list-item">📝 {n.body}</div>)}
          {results.sources.map((s: any) => <a key={s.id} className="list-item" href={s.url ?? undefined} target="_blank" rel="noreferrer">📚 {s.title}</a>)}
          {!results.lessons.length && !results.concepts.length && !results.notes.length && !results.sources.length && <p className="empty">{t('nothing_yet')}</p>}
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist">
            {tabs.map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label} ({n})</button>
            ))}
          </div>
          <div className="card">
            {tab === 'read' && (data.read.length ? data.read.map((l) => <Link key={l.id} className="list-item" to={L(l.id)}><b>{l.title}</b>{l.saved ? ' 🔖' : ''}<div className="faint">{fmtDate(l.read_at, locale)}</div></Link>) : <p className="empty">{t('nothing_yet')}</p>)}
            {tab === 'saved' && (data.saved.length ? data.saved.map((l) => <Link key={l.id} className="list-item" to={L(l.id)}><b>{l.title}</b><div className="faint">{l.key_question}</div></Link>) : <p className="empty">{t('nothing_yet')}</p>)}
            {tab === 'concepts' && (data.concepts.length ? data.concepts.map((c) => <Link key={c.id} className="list-item" to={L(c.lesson_id)}><b style={{ color: 'var(--primary)' }}>{c.term}</b>: {c.definition}<div className="faint">{c.lesson_title}</div></Link>) : <p className="empty">{t('nothing_yet')}</p>)}
            {tab === 'notes' && (data.notes.length ? data.notes.map((n) => (
              <div key={n.id} className="list-item">
                {editing?.id === n.id ? (
                  <>
                    <textarea className="input" value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} />
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn sm primary" onClick={async () => { await put(`/notes/${n.id}`, { body: editing.body }); setEditing(null); reload(); }}>{t('save')}</button>
                      <button className="btn sm ghost" onClick={() => setEditing(null)}>{t('cancel')}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{n.body}</p>
                    <div className="spread faint">
                      <span>{n.lesson_id ? <Link to={L(n.lesson_id)}>{n.lesson_title}</Link> : null} · {fmtDate(n.created_at, locale)}</span>
                      <span className="row">
                        <button className="btn sm ghost" onClick={() => setEditing({ id: n.id, body: n.body })}>{t('edit')}</button>
                        <button className="btn sm ghost" onClick={async () => { await del(`/notes/${n.id}`); reload(); }}>{t('delete')}</button>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )) : <p className="empty">{t('nothing_yet')}</p>)}
            {tab === 'sources' && (
              <>
                {kinds.length > 1 && (
                  <div className="chips" style={{ marginBottom: 8 }}>
                    <button className={`chip${kindFilter === 'all' ? ' on' : ''}`} onClick={() => setKindFilter('all')}>∗</button>
                    {kinds.map((k) => <button key={k} className={`chip${kindFilter === k ? ' on' : ''}`} onClick={() => setKindFilter(k)}>{k}</button>)}
                  </div>
                )}
                {data.sources.filter((s) => kindFilter === 'all' || s.kind === kindFilter).map((s) => (
                  <div key={s.id} className="source">
                    <div className="t" dir="auto">{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</div>
                    <div className="row wrap faint">
                      {[s.authors, s.year].filter(Boolean).join(' · ')}
                      {s.is_primary ? <span className="tag gold">{t('primary')}</span> : null}
                      <VerifyTag status={s.verification_status} />
                      <span>{t('used_in', { n: s.uses })}</span>
                    </div>
                  </div>
                ))}
                {!data.sources.length && <p className="empty">{t('nothing_yet')}</p>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
