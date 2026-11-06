import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, post } from '../api';
import { useApp } from '../state';
import { ErrorBox, Loading } from '../components/ui';
import { MicButton } from '../components/MicButton';
import { IFloat, ISend, ISpeaker } from '../components/Icons';
import { useSpeech } from '../voice';

type Msg = { id: string; role: 'user' | 'assistant'; content: string; meta?: any };

/** The companion conversation. Also rendered inside the floating window. */
export function CompanionChat({ journeyId, lessonId, initialAsk, initialContext, compact }: { journeyId: string; lessonId: string | null; initialAsk?: string | null; initialContext?: string | null; compact?: boolean }) {
  const { t, me, locale } = useApp();
  const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [context, setContext] = useState<string | null>(initialContext ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voiceReply, setVoiceReply] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const speech = useSpeech(locale, me?.prefs.voice.rate ?? 1, me?.prefs.voice.voiceName ?? null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ messages: Msg[] }>(`/journeys/${journeyId}/companion`);
      setMsgs(r.messages);
    } catch (e: any) {
      setErr(e.code);
      setMsgs([]);
    }
  }, [journeyId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length, busy]);

  const send = useCallback(
    async (q: string, spoken = false) => {
      if (!q.trim()) return;
      setBusy(true);
      setErr(null);
      setMsgs((m) => [...(m ?? []), { id: `tmp${Date.now()}`, role: 'user', content: q }]);
      setText('');
      try {
        const r = await post(`/journeys/${journeyId}/companion`, { text: q, lessonId, context: context ?? undefined });
        setContext(null);
        await load();
        if ((spoken || voiceReply) && speech.supported) speech.play(r.reply);
        if (r.action === 'open_lesson' && r.lessonId && !compact) nav(`/j/${journeyId}/lesson/${r.lessonId}`);
        if (r.action === 'open_review' && !compact) nav(`/j/${journeyId}/review`);
      } catch (e: any) {
        setErr(e.code ?? 'default');
        await load();
      } finally {
        setBusy(false);
      }
    },
    [journeyId, lessonId, context, load, voiceReply, speech, nav, compact],
  );

  useEffect(() => {
    if (msgs && initialAsk && !asked.current) {
      asked.current = true;
      void send(initialAsk);
    }
  }, [msgs, initialAsk, send]);

  if (!msgs) return <Loading />;
  return (
    <div>
      <div className="chat" aria-live="polite">
        {msgs.length === 0 && <p className="muted">{t('companion_ph')}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role === 'user' ? 'me' : 'bot'}${m.meta?.action === 'note_saved' ? ' note' : ''}`} dir="auto">
            {m.content}
            {m.role === 'assistant' && speech.supported && !compact && (
              <button className="btn sm ghost" style={{ minHeight: 28, padding: '0 6px', marginInlineStart: 4 }} aria-label={t('listen')} onClick={() => speech.play(m.content)}><ISpeaker /></button>
            )}
          </div>
        ))}
        {busy && <div className="bubble bot"><span className="typing"><i /><i /><i /></span></div>}
        <div ref={endRef} style={{ height: 1, scrollMarginBottom: compact ? 0 : 150 }} />
      </div>
      {err && <ErrorBox code={err} />}
      {msgs.length < 3 && (
        <div className="chips" style={{ margin: '12px 0' }}>
          {t.d.suggestions.map((s) => (
            <button key={s} className="chip" onClick={() => (s.endsWith(': ') ? setText(s) : send(s))}>{s}</button>
          ))}
        </div>
      )}
      {context && (
        <div className="banner info row" style={{ justifyContent: 'space-between' }}>
          <span>{t('context_shared')}: «{context.slice(0, 80)}…»</span>
          <button className="btn sm ghost" onClick={() => setContext(null)}>×</button>
        </div>
      )}
      <form className="composer" style={compact ? { position: 'static' } : undefined} onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea
          className="input"
          rows={1}
          value={text}
          placeholder={t('companion_ph')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          aria-label={t('companion_ph')}
        />
        <MicButton onFinal={(x) => { setVoiceReply(true); void send(x, true); }} />
        <button className="icon-btn" style={{ background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }} disabled={busy || !text.trim()} aria-label={t('send')}>
          <ISend style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} />
        </button>
      </form>
    </div>
  );
}

/** Floating window via the Document Picture-in-Picture API (stays above other windows); popup fallback. */
function useFloating() {
  const [win, setWin] = useState<Window | null>(null);
  const open = async (fallbackUrl: string) => {
    const dpip = (window as any).documentPictureInPicture;
    if (dpip?.requestWindow) {
      const w: Window = await dpip.requestWindow({ width: 380, height: 560 });
      [...document.styleSheets].forEach((ss) => {
        try {
          const style = w.document.createElement('style');
          style.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n');
          w.document.head.appendChild(style);
        } catch {
          if (ss.href) {
            const link = w.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = ss.href;
            w.document.head.appendChild(link);
          }
        }
      });
      w.document.documentElement.dir = document.documentElement.dir;
      w.document.documentElement.lang = document.documentElement.lang;
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) w.document.documentElement.setAttribute('data-theme', theme);
      w.document.body.style.padding = '10px';
      w.addEventListener('pagehide', () => setWin(null));
      setWin(w);
    } else {
      window.open(fallbackUrl, 'manara-mini', 'width=390,height=620');
    }
  };
  return { win, open };
}

export default function Companion() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { t } = useApp();
  const lessonId = sp.get('lesson');
  const mini = sp.get('mini') === '1';
  const floating = useFloating();
  const [lessonTitle, setLessonTitle] = useState<string | null>(null);
  useEffect(() => {
    if (lessonId) api(`/lessons/${lessonId}`).then((d) => setLessonTitle(d.lesson.title)).catch(() => undefined);
  }, [lessonId]);
  const [shared] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('manara.share');
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem('manara.share');
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div>
      {!mini && (
        <div className="topbar">
          <h1 className="title" style={{ margin: 0 }}>{t('companion_title')}</h1>
          <button className="icon-btn" title={t('float_help')} aria-label={t('float')} onClick={() => floating.open(`/j/${id}/companion?mini=1`)}><IFloat /></button>
        </div>
      )}
      {lessonTitle && <p className="tag ok" style={{ marginBottom: 10 }}>{t('discussing', { t: lessonTitle })}</p>}
      <CompanionChat journeyId={id!} lessonId={lessonId} initialAsk={sp.get('ask')} initialContext={shared} compact={mini} />
      {floating.win && createPortal(<CompanionChat journeyId={id!} lessonId={lessonId} compact />, floating.win.document.body)}
    </div>
  );
}
