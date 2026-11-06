import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api';
import { useApp, useLoad } from '../state';
import { ErrorBox, Loading, Sheet } from '../components/ui';
import { VerifyTag } from '../components/PlanView';
import { IBack, IBookmark, IPause, IPlay, IRepeat, ISpeaker, IStop } from '../components/Icons';
import { useSpeech } from '../voice';
import { QuizCards } from './Review';

type Para = { text: string; type: 'fact' | 'inference' | 'opinion'; certainty: 'high' | 'medium' | 'low'; cites: string[]; quote: { text: string; cite: string } | null; holder?: string | null; unsupported?: boolean };
type Source = { id: string; title: string; authors: string | null; year: string | null; publisher: string | null; doi: string | null; url: string | null; kind: string; is_primary: number; verification_status: string; verification_note: string | null; origin: string; accessed_at: string };
type Payload = {
  lesson: { id: string; journey_id: string; title: string; key_question: string | null; status: string; error: string | null; saved: number; max_level_opened: number; content_mode: string | null; verification: any; read_at: string | null };
  sections: { level: number; kind: string; title: string; minutes: number; body: any }[];
  sources: Source[];
  excerpts: { id: string; source_id: string; text: string; locator: string | null; origin: string }[];
  node: { title: string; stage: string | null } | null;
  position: { seq: number; total: number };
  notes: { id: string; body: string; created_at: string }[];
  nextId: string | null;
  prevId: string | null;
};

export default function Lesson() {
  const { id, lid } = useParams();
  const { t, me, locale } = useApp();
  const nav = useNavigate();
  const { data, error, reload, setData } = useLoad(() => api<Payload>(`/lessons/${lid}`), [lid]);
  const [opened, setOpened] = useState(1);
  const [cite, setCite] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<any[] | null>(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const strict = me?.prefs.documentation === 'strict';
  const speech = useSpeech(locale, me?.prefs.voice.rate ?? 1, me?.prefs.voice.voiceName ?? null);

  useEffect(() => {
    startedAt.current = Date.now();
    setQuiz(null);
  }, [lid]);
  useEffect(() => {
    if (data) setOpened(Math.max(1, data.lesson.max_level_opened));
  }, [data?.lesson.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while generating.
  const status = data?.lesson.status;
  useEffect(() => {
    if (status !== 'generating' && status !== 'planned') return;
    const timer = window.setInterval(async () => {
      try {
        const d = await api<Payload>(`/lessons/${lid}`);
        if (d.lesson.status !== 'generating' && d.lesson.status !== 'planned') setData(d);
      } catch {
        /* retry */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [status, lid, setData]);

  const sourceNum = useMemo(() => new Map((data?.sources ?? []).map((s, i) => [s.id, i + 1])), [data?.sources]);
  const excerptById = useMemo(() => new Map((data?.excerpts ?? []).map((e) => [e.id, e])), [data?.excerpts]);
  const sourceById = useMemo(() => new Map((data?.sources ?? []).map((s) => [s.id, s])), [data?.sources]);

  const levelText = (maxLevel: number) =>
    (data?.sections ?? [])
      .filter((s) => s.level <= maxLevel && s.level <= 4)
      .map((s) => [s.title, ...(s.body.paragraphs ?? []).filter((p: Para) => !(strict && p.unsupported)).map((p: Para) => p.text), ...(s.body.concepts ?? []).map((c: any) => `${c.term}: ${c.definition}`), ...(s.body.positions ?? []).map((p: any) => `${p.position}. ${p.arguments}`)].join('. '))
      .join('. ');

  useEffect(() => {
    if (data?.lesson.status === 'ready' && me?.prefs.voice.autoRead && speech.supported) speech.play(`${data.lesson.title}. ${levelText(1)}`);
  }, [data?.lesson.id, data?.lesson.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const L = data.lesson;

  if (L.status === 'generating' || L.status === 'planned') return (<div><BackBar /><div className="card"><h2>{L.title}</h2><Loading lines={4} label={t('preparing_lesson')} /></div></div>);
  if (L.status === 'failed') return (
    <div><BackBar />
      <div className="card"><h2>{L.title}</h2><ErrorBox code={L.error ?? 'default'} onRetry={async () => { await post(`/lessons/${lid}/generate`); reload(); }} /></div>
    </div>
  );

  const markRead = async () => {
    if (L.status !== 'read') await post(`/lessons/${lid}/read`, { seconds: (Date.now() - startedAt.current) / 1000 }).catch(() => undefined);
  };
  const openMore = async () => {
    const next = Math.min(5, opened + 1);
    setOpened(next);
    void post(`/lessons/${lid}/level`, { level: next }).catch(() => undefined);
    setTimeout(() => document.getElementById(`level-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const toCompanion = async (ask: string) => {
    await markRead();
    nav(`/j/${id}/companion?lesson=${lid}&ask=${encodeURIComponent(ask)}`);
  };
  const flash = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(null), 2500);
  };

  const v = L.verification;
  const nextSection = data.sections.find((s) => s.level === opened + 1);

  const renderParas = (ps: Para[]) =>
    ps
      .filter((p) => !(strict && p.unsupported))
      .map((p, i) => (
        <div key={i}>
          {p.quote && (
            <blockquote>
              «{p.quote.text}» <CiteBtn eid={p.quote.cite} />
            </blockquote>
          )}
          <p className={`para ${p.unsupported ? 'unsupported' : p.type === 'inference' ? 'inference' : ''}`}>
            {p.text}
            {p.cites.map((c) => <CiteBtn key={c} eid={c} />)}
            {(p.type !== 'fact' || p.certainty === 'low' || p.unsupported) && (
              <span className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                {p.type === 'inference' && <span className="tag">{t('inference_note')}</span>}
                {p.type === 'opinion' && <span className="tag gold">{t('opinion_note')}{p.holder ? `: ${p.holder}` : ''}</span>}
                {p.certainty === 'low' && <span className="tag warn">{t('low_certainty')}</span>}
                {p.unsupported && <span className="tag warn">{t('unsupported_note')}</span>}
              </span>
            )}
          </p>
        </div>
      ));

  function CiteBtn({ eid }: { eid: string }) {
    const ex = excerptById.get(eid);
    const n = ex ? sourceNum.get(ex.source_id) : undefined;
    if (!n) return null;
    return <button className="cite" onClick={() => setCite(eid)} aria-label={`${t('source_of')} ${n}`}>{n}</button>;
  }

  const sectionBody = (s: Payload['sections'][number]) => {
    const b = s.body;
    switch (s.kind) {
      case 'summary':
        return (
          <>
            {renderParas(b.paragraphs ?? [])}
            {b.links?.length > 0 && (
              <div className="card soft" style={{ marginTop: 8 }}>
                <b>{t('links_prev')}</b>
                {b.links.map((l: any, i: number) => <p key={i} style={{ margin: '4px 0' }}>• <b>{l.lesson}</b>: {l.relation}</p>)}
              </div>
            )}
            {b.uncertainty && <div className="banner warn" style={{ marginTop: 8 }}><b>{t('limits')}:</b> {b.uncertainty}</div>}
          </>
        );
      case 'concepts':
        return (b.concepts ?? []).map((c: any, i: number) => (
          <div key={i} className="concept"><b>{c.term}</b>: {c.definition} {c.cites.map((x: string) => <CiteBtn key={x} eid={x} />)}</div>
        ));
      case 'evidence':
        return (
          <>
            {renderParas(b.paragraphs ?? [])}
            {(b.positions ?? []).filter((p: any) => !(strict && p.unsupported)).map((p: any, i: number) => (
              <div key={i} className="position">
                <div className="spread"><b>{p.position}</b><span className={`tag ${p.strength === 'strong' ? 'ok' : p.strength === 'contested' ? 'warn' : ''}`}>{strengthLabel(p.strength, locale)}</span></div>
                <div className="faint">{p.holders}</div>
                <p style={{ margin: '6px 0 0' }}>{p.arguments} {p.cites.map((x: string) => <CiteBtn key={x} eid={x} />)}</p>
                {p.unsupported && <span className="tag warn">{t('unsupported_note')}</span>}
              </div>
            ))}
          </>
        );
      case 'sources':
        return (
          <>
            {(b.further ?? []).map((f: any, i: number) => {
              const s = sourceById.get(f.sourceId);
              return s ? <SourceItem key={i} s={s} n={sourceNum.get(s.id)!} why={f.why} locator={f.locator} /> : null;
            })}
            {data.sources.filter((s) => !(b.further ?? []).some((f: any) => f.sourceId === s.id)).map((s) => <SourceItem key={s.id} s={s} n={sourceNum.get(s.id)!} />)}
            {data.sources.length === 0 && <p className="faint">{L.content_mode === 'demo' ? t('demo_banner') : t('nothing_yet')}</p>}
          </>
        );
      default:
        return renderParas(b.paragraphs ?? []);
    }
  };

  const citeEx = cite ? excerptById.get(cite) : null;
  const citeSrc = citeEx ? sourceById.get(citeEx.source_id) : null;

  return (
    <article className="lesson">
      <BackBar extra={<span className="faint">{t('position', { n: data.position.seq, t: data.position.total })}</span>} />
      {L.content_mode === 'demo' && <div className="banner info">{t('demo_banner')}</div>}
      {data.node?.stage && <div className="faint">{data.node.stage} · {data.node.title}</div>}
      <h1>{L.title}</h1>
      {L.key_question && <p className="muted" style={{ fontSize: '1.05rem' }}><b>{t('key_question')}:</b> {L.key_question}</p>}

      <div className="row wrap" style={{ margin: '8px 0 4px' }}>
        {speech.supported && (
          <button className="btn sm" onClick={() => speech.play(`${L.title}. ${levelText(opened)}`, (s) => void post(`/lessons/${lid}/listen`, { seconds: s }).catch(() => undefined))}>
            <ISpeaker /> {t('listen')}
          </button>
        )}
        <button className="btn sm" aria-pressed={!!L.saved} onClick={async () => { await post(`/lessons/${lid}/save`, { saved: !L.saved }); setData({ ...data, lesson: { ...L, saved: L.saved ? 0 : 1 } }); }}>
          <IBookmark fill={L.saved ? 'currentColor' : 'none'} /> {L.saved ? t('saved') : t('save_it')}
        </button>
      </div>

      {v && (v.unsupported > 0 || v.quotesRejected > 0 || v.supported > 0) && (
        <details className="faint" style={{ margin: '6px 0' }}>
          <summary>{t('verification')}</summary>
          <p style={{ margin: '4px 0' }}>{t('verification_line', { s: v.supported, u: v.unsupported, i: v.uncited ?? 0 })}</p>
          {v.quotesRejected > 0 && <p style={{ margin: 0 }}>{t('quotes_rejected', { n: v.quotesRejected })}</p>}
        </details>
      )}

      {data.sections.filter((s) => s.level <= opened).map((s) => (
        <section key={s.level} id={`level-${s.level}`}>
          {s.level > 1 && (
            <div className="level-head"><span className="num">{s.level}</span><h2 style={{ margin: 0 }}>{s.title}</h2></div>
          )}
          {sectionBody(s)}
        </section>
      ))}

      {nextSection && (
        <button className="more-btn" onClick={openMore}>
          <span>{t('more_next', { title: nextSection.title })}</span>
          <span className="faint">{t('approx_min', { m: nextSection.minutes })}</span>
        </button>
      )}

      {speech.state !== 'idle' && (
        <div className="voicebar" role="region" aria-label={t('listen')}>
          {speech.state === 'playing'
            ? <button className="icon-btn" onClick={speech.pause} aria-label={t('pause')}><IPause /></button>
            : <button className="icon-btn" onClick={speech.resume} aria-label={t('play')}><IPlay /></button>}
          <button className="icon-btn" onClick={speech.repeat} aria-label={t('repeat')}><IRepeat /></button>
          <button className="icon-btn" onClick={speech.stop} aria-label={t('stop')}><IStop /></button>
          <span className="faint" style={{ flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{speech.current}</span>
        </div>
      )}

      <hr />
      {quiz ? (
        <div className="card">
          <h3>{t('quiz')}</h3>
          <QuizCards items={quiz} onDone={() => setQuiz(null)} />
        </div>
      ) : (
        <div className="card soft">
          <h3>{t('how_continue')}</h3>
          <div className="next-actions">
            <button className="btn primary" onClick={async () => { await markRead(); flash(t('great')); nav(data.nextId ? `/j/${id}` : `/j/${id}/progress`); }}>{t('enough_today')}</button>
            <button className="btn" onClick={() => (nextSection ? openMore() : toCompanion(locale === 'ar' ? 'أريد المزيد من التفصيل في هذه المادة' : 'Tell me more about this unit'))}>{t('want_more')}</button>
            <button className="btn" onClick={() => toCompanion(locale === 'ar' ? 'ناقشني في هذه المادة' : 'Discuss this unit with me')}>{t('discuss')}</button>
            <button className="btn" onClick={async () => { await markRead(); const r = await api(`/lessons/${lid}/quiz`); setQuiz(r.items); }}>{t('quiz')}</button>
            <button className="btn" onClick={() => toCompanion(locale === 'ar' ? 'اربط هذه المادة بما تعلمته سابقًا' : 'Connect this unit to what I learned before')}>{t('link_prev')}</button>
            {data.nextId && <button className="btn" onClick={async () => { await markRead(); nav(`/j/${id}/lesson/${data.nextId}`); }}>{t('next_lesson')}</button>}
          </div>
        </div>
      )}

      <div className="card">
        <h3>{t('add_note')}</h3>
        {data.notes.map((n) => <p key={n.id} className="bubble note" style={{ maxWidth: '100%' }}>{n.body}</p>)}
        <textarea className="input" rows={2} placeholder={t('note_ph')} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn sm" style={{ marginTop: 8 }} disabled={!note.trim()} onClick={async () => { await post('/notes', { journeyId: id, lessonId: lid, body: note }); setNote(''); reload(); }}>{t('save')}</button>
      </div>

      {toast && <div className="banner info" style={{ position: 'fixed', bottom: 90, insetInline: 16, zIndex: 50 }}>{toast}</div>}

      <Sheet open={!!cite} onClose={() => setCite(null)} label={t('excerpt')}>
        {citeSrc && citeEx && (
          <div>
            <div className="faint">{t('excerpt')}</div>
            <blockquote dir="auto">{citeEx.text}</blockquote>
            {citeEx.locator && <p className="faint">{citeEx.locator}</p>}
            <SourceItem s={citeSrc} n={sourceNum.get(citeSrc.id)!} />
            <button className="btn block" onClick={() => setCite(null)}>{t('close')}</button>
          </div>
        )}
      </Sheet>
    </article>
  );
}

function strengthLabel(s: string, locale: string) {
  const ar: Record<string, string> = { strong: 'قوي الأدلة', moderate: 'متوسط', weak: 'ضعيف الأدلة', contested: 'محل نزاع' };
  const en: Record<string, string> = { strong: 'Strong evidence', moderate: 'Moderate', weak: 'Weak evidence', contested: 'Contested' };
  return (locale === 'ar' ? ar : en)[s] ?? s;
}

function BackBar({ extra }: { extra?: React.ReactNode }) {
  const { id } = useParams();
  const { t, locale } = useApp();
  return (
    <div className="topbar">
      <Link to={`/j/${id}`} className="icon-btn" aria-label={t('back')}><IBack style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} /></Link>
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  );
}

export function SourceItem({ s, n, why, locator }: { s: Source; n: number; why?: string; locator?: string | null }) {
  const { t, locale } = useApp();
  const role = s.is_primary ? t('primary') : s.kind === 'encyclopedia' || s.kind === 'reference' ? t('tertiary') : t('secondary');
  return (
    <div className="source">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="cite" style={{ verticalAlign: 'baseline' }}>{n}</span>
        <div style={{ flex: 1 }}>
          <div className="t" dir="auto">{s.title}</div>
          <div className="faint" dir="auto">{[s.authors, s.publisher, s.year].filter(Boolean).join(' · ')}</div>
          {s.doi && <div className="faint" dir="ltr">DOI: {s.doi}</div>}
          {locator && <div className="faint">{locator}</div>}
          {why && <p style={{ margin: '4px 0' }}>{why}</p>}
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <span className={`tag ${s.is_primary ? 'gold' : ''}`}>{role}</span>
            <VerifyTag status={s.verification_status} />
            <span className="faint">{(locale === 'ar' ? 'تاريخ الوصول: ' : 'Accessed: ') + new Date(s.accessed_at).toLocaleDateString(locale)}</span>
          </div>
          {s.url && <a className="btn sm" style={{ marginTop: 6 }} href={s.url} target="_blank" rel="noreferrer">{t('open_source')}</a>}
        </div>
      </div>
    </div>
  );
}
