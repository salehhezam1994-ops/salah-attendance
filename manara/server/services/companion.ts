import { q } from '../db.ts';
import { HttpError, newId, normalizeText, nowIso, parseJson } from '../util.ts';
import { aiMode, llm, type ChatMsg } from '../ai/llm.ts';
import { tutorReply, cumulativeSummary, UpdatesSchema } from '../ai/tutor.ts';
import { schedule, dailyReviewBudget, type ReviewResult } from '../ai/review.ts';
import { checkLimit, recordUsage } from '../limits.ts';
import { addMessage, conversationId, getJourney, interviewOf, messagesOf, requestChange } from './journeys.ts';
import { lessonPlainText, todayLesson, ensureLessonReady } from './lessons.ts';
import type { Goal } from '../ai/planner.ts';
import { storeSources } from './sources.ts';
import { notifyUpdates } from './notifier.ts';

/* ------------------------------ Companion chat ------------------------------ */

type Intent =
  | { kind: 'save_note'; body: string }
  | { kind: 'where' }
  | { kind: 'next' }
  | { kind: 'quiz' }
  | { kind: 'plan_change'; request: string }
  | { kind: 'link' }
  | { kind: 'simplify' }
  | { kind: 'more' }
  | { kind: 'ask' };

/** Command understanding for typed/voice commands (works without AI). */
export function detectIntent(text: string): Intent {
  const n = normalizeText(text);
  const note = text.match(/^(?:احفظ(?: هذه)? (?:الملاحظه|الملاحظة|ملاحظه|ملاحظة)|سجل ملاحظه|سجل ملاحظة|save (?:this )?note)\s*[:：-]?\s*(.*)$/i);
  if (note) return { kind: 'save_note', body: note[1] || text };
  if (/^(اين وصلنا|وين وصلنا|where are we|where did we stop)/.test(n)) return { kind: 'where' };
  if (/^(انتقل الي الماده التاليه|الماده التاليه|التالي|next lesson|next)$/.test(n)) return { kind: 'next' };
  if (/^(اختبر فهمي|اختبرني|quiz me|test me)/.test(n)) return { kind: 'quiz' };
  if (/^(اجعل الخطه|غير الخطه|عدل الخطه|اجعل القراءه|اريد مزيدا من|ركز علي|اضف محورا|لا اريد التوسع|make the plan|change the plan|make it)/.test(n)) return { kind: 'plan_change', request: text };
  if (/(اربط|ربط).*(سبق|السابق)|connect.*(before|earlier)|link.*(previous|earlier)/.test(n)) return { kind: 'link' };
  if (/^(اختصر|بسط|لخص|simplify|summarize|shorten)/.test(n)) return { kind: 'simplify' };
  if (/^(اريد المزيد|المزيد من التفصيل|more detail|tell me more)/.test(n)) return { kind: 'more' };
  return { kind: 'ask' };
}

export async function companionMessage(userId: string, journeyId: string, text: string, lessonId: string | null, contextText?: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  const ar = st.lang === 'ar';
  const conv = conversationId(userId, journeyId, 'tutor');
  const clean = text.trim().slice(0, 4000);
  if (!clean) throw new HttpError(400, 'empty');
  addMessage(conv, 'user', clean, { lessonId, hasContext: !!contextText });
  const intent = contextText ? ({ kind: 'ask' } as Intent) : detectIntent(clean);
  const reply = (content: string, meta?: Record<string, unknown>) => {
    addMessage(conv, 'assistant', content, meta);
    return { reply: content, ...(meta ?? {}) };
  };

  switch (intent.kind) {
    case 'save_note': {
      const id = newId('nt_');
      q.run('INSERT INTO notes(id,user_id,journey_id,lesson_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', id, userId, journeyId, lessonId, intent.body, nowIso(), nowIso());
      return reply(ar ? `حفظت الملاحظة في مكتبتك: «${intent.body.slice(0, 120)}»` : `Saved to your library: "${intent.body.slice(0, 120)}"`, { action: 'note_saved', noteId: id });
    }
    case 'where': {
      const p = journeyProgress(journeyId);
      const today = todayLesson(journeyId);
      return reply(
        ar
          ? `أنت في مرحلة «${p.currentStage ?? '—'}». أنجزت ${p.read} من ${p.total} مادة (${p.percent}%).${today ? ` مادتك التالية: «${today.title}».` : ''}`
          : `You are in stage "${p.currentStage ?? '—'}". ${p.read} of ${p.total} units done (${p.percent}%).${today ? ` Next: "${today.title}".` : ''}`,
        { action: 'where', lessonId: today?.id ?? null },
      );
    }
    case 'next': {
      const today = todayLesson(journeyId);
      if (today) void ensureLessonReady(userId, today.id).catch(() => undefined);
      return reply(ar ? (today ? `لننتقل إلى «${today.title}».` : 'أنهيت جميع مواد الخطة.') : today ? `Let's go to "${today.title}".` : 'You finished the plan.', { action: 'open_lesson', lessonId: today?.id ?? null });
    }
    case 'quiz':
      return reply(ar ? 'لنختبر فهمك بأسئلة قصيرة مما درسته.' : "Let's check your understanding with short questions.", { action: 'open_review' });
    case 'plan_change': {
      const r = await requestChange(userId, journeyId, intent.request);
      return reply(
        r.needsConfirmation
          ? (ar ? `هذا تغيير كبير: ${r.change.summary}. هل تؤكده؟` : `This is a significant change: ${r.change.summary}. Confirm?`)
          : (ar ? `تم: ${r.change.summary}` : `Done: ${r.change.summary}`),
        { action: r.needsConfirmation ? 'confirm_change' : 'plan_changed' },
      );
    }
    default:
      break;
  }

  // Free conversation with the Tutor (needs AI).
  if (aiMode() === 'off') return reply(ar ? 'المرافق الحواري يحتاج إلى تهيئة الذكاء الاصطناعي على الخادم. يمكنك الآن قراءة المواد وحفظ الملاحظات والمراجعة.' : 'The conversational tutor needs AI to be configured on the server.', { action: 'ai_off' });
  checkLimit(userId, 'tutor');
  const goal = parseJson<Goal | null>(j.goal_json, null);
  const lesson = lessonId ? q.get<{ id: string; title: string; seq: number }>('SELECT id,title,seq FROM lessons WHERE id=? AND journey_id=?', lessonId, journeyId) : null;
  const sources = lesson
    ? q.all<{ title: string; authors: string | null; year: string | null }>('SELECT DISTINCT s.title,s.authors,s.year FROM sources s JOIN source_refs r ON r.source_id=s.id WHERE r.lesson_id=?', lesson.id).map((s, i) => ({ sid: `S${i + 1}`, ...s }))
    : [];
  const earlier = q
    .all<{ id: string; title: string }>("SELECT id,title FROM lessons WHERE journey_id=? AND status='read' ORDER BY seq", journeyId)
    .map((l) => ({ title: l.title, concepts: q.all<{ term: string }>('SELECT term FROM concepts WHERE lesson_id=?', l.id).map((c) => c.term) }));
  const stage = q.get<{ title: string }>("SELECT s.title FROM stages s JOIN nodes n ON n.stage_id=s.id WHERE n.journey_id=? AND n.status='current' ORDER BY s.idx LIMIT 1", journeyId)?.title ?? '';
  const history: ChatMsg[] = messagesOf(conv)
    .filter((m) => !(m.meta as { action?: string } | null)?.action)
    .slice(-14)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  if (contextText) history[history.length - 1] = { role: 'user', content: `${clean}\n\n«النص الذي أشاركه»:\n${contextText.slice(0, 6000)}` };
  if (history[0]?.role === 'assistant') history.shift();
  const mode = intent.kind === 'link' ? 'link' : intent.kind === 'simplify' ? 'simplify' : intent.kind === 'more' ? 'explain' : lesson ? 'discuss' : 'free';
  const text2 = await tutorReply(llm(), {
    lang: st.lang,
    goal: goal?.statement ?? st.slots.topic ?? '',
    journeyTitle: j.title ?? j.topic,
    stage,
    detail: st.slots.detail ?? 'medium',
    lesson: lesson ? { title: lesson.title, text: lessonPlainText(lesson.id) } : null,
    sources,
    earlier,
    notes: q.all<{ body: string }>('SELECT body FROM notes WHERE journey_id=? ORDER BY created_at DESC LIMIT 5', journeyId).map((n) => n.body),
    mode,
  }, history);
  recordUsage(userId, 'tutor');
  if (lesson) q.run('INSERT INTO progress_events(id,user_id,journey_id,lesson_id,kind,seconds,created_at) VALUES (?,?,?,?,?,?,?)', newId('pe_'), userId, journeyId, lesson.id, 'discuss', 0, nowIso());
  return reply(text2, { sources });
}

/* ------------------------------ Progress ------------------------------ */

export function journeyProgress(journeyId: string) {
  const total = q.get<{ n: number }>('SELECT COUNT(*) n FROM lessons WHERE journey_id=?', journeyId)!.n;
  const read = q.get<{ n: number }>("SELECT COUNT(*) n FROM lessons WHERE journey_id=? AND status='read'", journeyId)!.n;
  const seconds = q.get<{ s: number | null }>("SELECT SUM(seconds) s FROM progress_events WHERE journey_id=?", journeyId)!.s ?? 0;
  const stages = q.all<{ id: string; idx: number; title: string }>('SELECT id,idx,title FROM stages WHERE journey_id=? ORDER BY idx', journeyId).map((s) => {
    const t = q.get<{ n: number; r: number }>("SELECT COUNT(*) n, SUM(CASE WHEN l.status='read' THEN 1 ELSE 0 END) r FROM lessons l JOIN nodes n ON n.id=l.node_id WHERE n.stage_id=?", s.id)!;
    return { ...s, total: t.n, read: t.r ?? 0, percent: t.n ? Math.round(((t.r ?? 0) / t.n) * 100) : 0 };
  });
  const currentStage = stages.find((s) => s.read < s.total)?.title ?? stages[stages.length - 1]?.title ?? null;
  const reviews = q.get<{ n: number; good: number | null }>("SELECT COUNT(*) n, SUM(CASE WHEN result='remembered' THEN 1 ELSE 0 END) good FROM review_answers a JOIN review_items i ON i.id=a.item_id WHERE i.journey_id=?", journeyId)!;
  const weak = q.all<{ title: string; lapses: number }>(
    'SELECT n.title, SUM(i.lapses) lapses FROM review_items i JOIN nodes n ON n.id=i.node_id WHERE i.journey_id=? GROUP BY n.id HAVING lapses>0 ORDER BY lapses DESC LIMIT 5', journeyId,
  );
  const strong = q.all<{ title: string }>(
    "SELECT n.title FROM nodes n WHERE n.journey_id=? AND n.status='done' AND NOT EXISTS (SELECT 1 FROM review_items i WHERE i.node_id=n.id AND i.lapses>0) ORDER BY n.order_idx LIMIT 5", journeyId,
  );
  const concepts = q.get<{ n: number }>('SELECT COUNT(*) n FROM concepts c JOIN lessons l ON l.id=c.lesson_id WHERE c.journey_id=? AND l.status=\'read\'', journeyId)!.n;
  const sourcesN = q.get<{ n: number }>("SELECT COUNT(DISTINCT r.source_id) n FROM source_refs r JOIN lessons l ON l.id=r.lesson_id WHERE l.journey_id=? AND l.status='read'", journeyId)!.n;
  const days = q.all<{ d: string }>("SELECT DISTINCT substr(created_at,1,10) d FROM progress_events WHERE journey_id=? ORDER BY d DESC LIMIT 60", journeyId).map((r) => r.d);
  return {
    total, read, percent: total ? Math.round((read / total) * 100) : 0, minutes: Math.round(seconds / 60), stages, currentStage,
    reviews: { total: reviews.n, remembered: reviews.good ?? 0 }, weak, strong: strong.map((s) => s.title), concepts, sources: sourcesN, activeDays: days.length,
  };
}

export async function journeySynthesis(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  const lessons = q.all<{ id: string; title: string }>("SELECT id,title FROM lessons WHERE journey_id=? AND status='read' ORDER BY seq", journeyId).map((l) => {
    const s = q.get<{ body_json: string }>('SELECT body_json FROM lesson_sections WHERE lesson_id=? AND level=1', l.id);
    return {
      title: l.title,
      summary: (parseJson<{ paragraphs?: { text: string }[] }>(s?.body_json, {}).paragraphs ?? []).map((p) => p.text).join(' ').slice(0, 900),
      concepts: q.all<{ term: string }>('SELECT term FROM concepts WHERE lesson_id=?', l.id).map((c) => c.term),
    };
  });
  if (!lessons.length) throw new HttpError(409, 'nothing_read_yet');
  if (aiMode() === 'off') throw new HttpError(503, 'ai_not_configured');
  checkLimit(userId, 'tutor');
  const p = journeyProgress(journeyId);
  const remaining = q.all<{ title: string }>("SELECT DISTINCT n.title FROM nodes n JOIN lessons l ON l.node_id=n.id WHERE n.journey_id=? AND l.status<>'read' ORDER BY l.seq LIMIT 12", journeyId).map((r) => r.title);
  const r = await cumulativeSummary(llm(), st.lang, parseJson<Goal | null>(j.goal_json, null)?.statement ?? j.topic, lessons.slice(-40), p.weak.map((w) => w.title), remaining);
  recordUsage(userId, 'tutor');
  return r;
}

/* ------------------------------ Review ------------------------------ */

export function dueReviews(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  const budget = dailyReviewBudget(interviewOf(j).slots.minutes_per_day ?? 10);
  const items = q.all<{ id: string; question: string; answer: string; lesson_id: string; lesson_title: string; due_at: string }>(
    `SELECT i.id,i.question,i.answer,i.lesson_id,l.title lesson_title,i.due_at FROM review_items i JOIN lessons l ON l.id=i.lesson_id
     WHERE i.user_id=? AND i.journey_id=? AND l.status='read' AND i.due_at<=? ORDER BY i.due_at LIMIT ?`,
    userId, journeyId, nowIso(), budget,
  );
  const upcoming = q.get<{ due_at: string }>("SELECT i.due_at FROM review_items i JOIN lessons l ON l.id=i.lesson_id WHERE i.journey_id=? AND l.status='read' AND i.due_at>? ORDER BY i.due_at LIMIT 1", journeyId, nowIso());
  return { items, budget, nextDue: upcoming?.due_at ?? null };
}

/** Quiz on a specific lesson (even if not due). */
export function lessonQuiz(userId: string, lessonId: string) {
  return q.all<{ id: string; question: string; answer: string }>('SELECT id,question,answer FROM review_items WHERE lesson_id=? AND user_id=?', lessonId, userId);
}

export function answerReview(userId: string, itemId: string, result: ReviewResult, userAnswer: string | null, sessionId: string | null) {
  const it = q.get<{ id: string; journey_id: string; ease: number; interval_days: number; reps: number; lapses: number; node_id: string }>('SELECT * FROM review_items WHERE id=? AND user_id=?', itemId, userId);
  if (!it) throw new HttpError(404, 'item_not_found');
  const s = schedule(it, result);
  q.run('UPDATE review_items SET ease=?, interval_days=?, reps=?, lapses=?, due_at=?, last_result=? WHERE id=?', s.ease, s.interval_days, s.reps, s.lapses, s.due_at, result, itemId);
  let sid = sessionId;
  if (!sid || !q.get('SELECT id FROM review_sessions WHERE id=? AND user_id=?', sid, userId)) {
    sid = newId('rs_');
    q.run('INSERT INTO review_sessions(id,user_id,journey_id,started_at) VALUES (?,?,?,?)', sid, userId, it.journey_id, nowIso());
  }
  q.run('INSERT INTO review_answers(id,session_id,item_id,user_answer,result,created_at) VALUES (?,?,?,?,?,?)', newId('ra_'), sid, itemId, userAnswer?.slice(0, 2000) ?? null, result, nowIso());
  q.run('UPDATE review_sessions SET total=total+1, remembered=remembered+?, finished_at=? WHERE id=?', result === 'remembered' ? 1 : 0, nowIso(), sid);
  q.run('INSERT INTO progress_events(id,user_id,journey_id,lesson_id,kind,seconds,created_at) VALUES (?,?,?,NULL,?,?,?)', newId('pe_'), userId, it.journey_id, 'review', 30, nowIso());
  // Mastery follows review performance.
  const stats = q.get<{ n: number; good: number }>("SELECT COUNT(*) n, SUM(CASE WHEN last_result='remembered' THEN 1 WHEN last_result='partial' THEN 0.5 ELSE 0 END) good FROM review_items WHERE node_id=? AND last_result IS NOT NULL", it.node_id)!;
  if (stats.n) q.run('UPDATE nodes SET mastery=? WHERE id=?', Math.min(1, 0.3 + 0.7 * (stats.good / stats.n)), it.node_id);
  return { sessionId: sid, nextDue: s.due_at };
}

/* ------------------------------ Knowledge base ------------------------------ */

export function searchKnowledge(userId: string, journeyId: string | null, term: string) {
  const like = `%${term.trim()}%`;
  const jf = journeyId ? 'AND j.id=?' : '';
  const jp = journeyId ? [journeyId] : [];
  return {
    lessons: q.all(`SELECT l.id,l.title,l.key_question,j.id journey_id FROM lessons l JOIN journeys j ON j.id=l.journey_id WHERE j.user_id=? ${jf} AND l.status IN ('ready','read') AND (l.title LIKE ? OR l.key_question LIKE ? OR EXISTS (SELECT 1 FROM lesson_sections s WHERE s.lesson_id=l.id AND s.body_json LIKE ?)) LIMIT 30`, userId, ...jp, like, like, like),
    concepts: q.all(`SELECT c.id,c.term,c.definition,c.lesson_id FROM concepts c JOIN journeys j ON j.id=c.journey_id WHERE j.user_id=? ${jf} AND (c.term LIKE ? OR c.definition LIKE ?) LIMIT 30`, userId, ...jp, like, like),
    notes: q.all(`SELECT n.id,n.body,n.lesson_id,n.created_at FROM notes n LEFT JOIN journeys j ON j.id=n.journey_id WHERE n.user_id=? ${journeyId ? 'AND n.journey_id=?' : ''} AND n.body LIKE ? LIMIT 30`, userId, ...jp, like),
    sources: q.all(`SELECT s.id,s.title,s.authors,s.year,s.url,s.kind,s.verification_status FROM sources s JOIN journeys j ON j.id=s.journey_id WHERE j.user_id=? ${jf} AND (s.title LIKE ? OR s.authors LIKE ?) LIMIT 30`, userId, ...jp, like, like),
  };
}

export function library(userId: string, journeyId: string) {
  getJourney(userId, journeyId);
  return {
    saved: q.all("SELECT id,title,key_question,read_at,seq FROM lessons WHERE journey_id=? AND saved=1 ORDER BY seq", journeyId),
    read: q.all("SELECT id,title,key_question,read_at,seq,saved FROM lessons WHERE journey_id=? AND status='read' ORDER BY seq DESC", journeyId),
    concepts: q.all("SELECT c.id,c.term,c.definition,c.lesson_id,l.title lesson_title FROM concepts c JOIN lessons l ON l.id=c.lesson_id WHERE c.journey_id=? AND l.status='read' ORDER BY c.term", journeyId),
    notes: q.all('SELECT n.id,n.body,n.lesson_id,n.created_at,n.updated_at,l.title lesson_title FROM notes n LEFT JOIN lessons l ON l.id=n.lesson_id WHERE n.user_id=? AND n.journey_id=? ORDER BY n.created_at DESC', userId, journeyId),
    sources: q.all(
      `SELECT s.*, (SELECT COUNT(DISTINCT r.lesson_id) FROM source_refs r JOIN lessons l ON l.id=r.lesson_id WHERE r.source_id=s.id AND l.status IN ('read','ready')) uses
       FROM sources s WHERE s.journey_id=? ORDER BY uses DESC, s.is_primary DESC, s.title`, journeyId,
    ),
  };
}

/* ------------------------------ Scientific updates ------------------------------ */

export async function checkUpdates(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  if (aiMode() !== 'anthropic') throw new HttpError(503, 'ai_not_configured');
  checkLimit(userId, 'research');
  const learned = q.all<{ title: string }>("SELECT title FROM lessons WHERE journey_id=? AND status='read' ORDER BY seq DESC LIMIT 15", journeyId).map((l) => l.title);
  const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const r = await llm().webResearch({
    task: 'updates',
    system: 'You track NEW scholarly developments for a learner. Search for studies, books and significant scholarly events published recently. Prefer peer-reviewed and authoritative sources; note publication dates exactly as shown in results. Ground every statement in search results.',
    prompt: `Field: ${st.slots.topic}. Learner focus: ${st.slots.focus ?? ''}. Find developments published after ${since}. Write short notes per item with its URL and date.`,
    maxSearches: 4,
  });
  recordUsage(userId, 'research');
  const allowed = new Set(r.results.map((x) => x.url));
  if (!allowed.size) return { added: 0 };
  const classified = await llm().json({
    task: 'updates_classify',
    tier: 'fast',
    system: `Classify scholarly updates for a learner in ${st.lang === 'ar' ? 'Arabic' : 'English'}. Use ONLY urls from the provided list. category: important (significant peer-reviewed or authoritative work), regular (ordinary study), opinion (commentary/opinion piece), unconfirmed (news not verified by scholarly sources), preliminary (preprint/early result needing verification). published: date as given or null. relation: how it relates to what the learner studied. recommend_add: true only if clearly worth a new lesson. Never invent items.`,
    prompt: JSON.stringify({ results: r.results, notes: r.text.slice(0, 8000), learned }),
    schema: UpdatesSchema,
  });
  let added = 0;
  for (const it of classified.items) {
    if (!allowed.has(it.url)) continue;
    const res = q.run(
      'INSERT OR IGNORE INTO updates(id,journey_id,title,summary,url,published,category,relation,recommend_add,found_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      newId('up_'), journeyId, it.title, it.summary, it.url, it.published, it.category, it.relation, it.recommend_add ? 1 : 0, nowIso(),
    );
    added += Number(res.changes);
  }
  q.run('UPDATE journeys SET updates_checked_at=? WHERE id=?', nowIso(), journeyId);
  await notifyUpdates(userId, journeyId, added);
  return { added };
}

/** Add an update to the plan as a new leaf (only on explicit user request). */
export async function addUpdateToPlan(userId: string, updateId: string) {
  const u = q.get<{ id: string; journey_id: string; title: string; summary: string; url: string }>('SELECT u.* FROM updates u JOIN journeys j ON j.id=u.journey_id WHERE u.id=? AND j.user_id=?', updateId, userId);
  if (!u) throw new HttpError(404, 'not_found');
  const parent = q.get<{ id: string; stage_id: string | null }>("SELECT id,stage_id FROM nodes WHERE journey_id=? ORDER BY CASE kind WHEN 'branch' THEN 0 WHEN 'trunk' THEN 1 ELSE 2 END, order_idx DESC LIMIT 1", u.journey_id);
  const nodeId = newId('n_');
  const order = (q.get<{ m: number }>('SELECT MAX(order_idx) m FROM nodes WHERE journey_id=?', u.journey_id)?.m ?? 0) + 1;
  q.run("INSERT INTO nodes(id,journey_id,stage_id,parent_id,kind,title,summary,order_idx,status,search_queries,lesson_order) VALUES (?,?,?,?,'leaf',?,?,?,'upcoming',?,1)", nodeId, u.journey_id, parent?.stage_id ?? null, parent?.id ?? null, u.title, u.summary, order, JSON.stringify([u.title]));
  const stored = await storeSources(u.journey_id, [{ url: u.url, title: u.title, kind: 'paper', origin: 'web_search', verified: false, excerpts: [] }]);
  for (const s of stored) q.run('INSERT OR IGNORE INTO node_sources(node_id,source_id) VALUES (?,?)', nodeId, s.id);
  const seq = (q.get<{ m: number }>('SELECT MAX(seq) m FROM lessons WHERE journey_id=?', u.journey_id)?.m ?? 0) + 1;
  // Insert right after the current lesson so it comes soon, shifting later ones.
  const today = todayLesson(u.journey_id);
  const at = today ? today.seq + 1 : seq;
  q.run('UPDATE lessons SET seq=seq+1 WHERE journey_id=? AND seq>=?', u.journey_id, at);
  q.run("INSERT INTO lessons(id,journey_id,node_id,seq,title,status,minutes) VALUES (?,?,?,?,?,'planned',?)", newId('l_'), u.journey_id, nodeId, at, u.title, interviewOf(getJourney(userId, u.journey_id)).slots.minutes_per_day ?? 10);
  q.run("UPDATE updates SET status='added' WHERE id=?", updateId);
  return { nodeId };
}

/* ------------------------------ Data rights ------------------------------ */

export function exportUserData(userId: string) {
  const tables: Record<string, string> = {
    user: 'SELECT id,email,name,created_at FROM users WHERE id=?',
    preferences: 'SELECT data FROM preferences WHERE user_id=?',
    journeys: 'SELECT * FROM journeys WHERE user_id=?',
    stages: 'SELECT s.* FROM stages s JOIN journeys j ON j.id=s.journey_id WHERE j.user_id=?',
    nodes: 'SELECT n.* FROM nodes n JOIN journeys j ON j.id=n.journey_id WHERE j.user_id=?',
    relations: 'SELECT r.* FROM relations r JOIN journeys j ON j.id=r.journey_id WHERE j.user_id=?',
    lessons: 'SELECT l.* FROM lessons l JOIN journeys j ON j.id=l.journey_id WHERE j.user_id=?',
    lesson_sections: 'SELECT s.* FROM lesson_sections s JOIN lessons l ON l.id=s.lesson_id JOIN journeys j ON j.id=l.journey_id WHERE j.user_id=?',
    sources: 'SELECT s.* FROM sources s JOIN journeys j ON j.id=s.journey_id WHERE j.user_id=?',
    excerpts: 'SELECT e.* FROM excerpts e JOIN sources s ON s.id=e.source_id JOIN journeys j ON j.id=s.journey_id WHERE j.user_id=?',
    concepts: 'SELECT c.* FROM concepts c JOIN journeys j ON j.id=c.journey_id WHERE j.user_id=?',
    notes: 'SELECT * FROM notes WHERE user_id=?',
    review_items: 'SELECT * FROM review_items WHERE user_id=?',
    review_answers: 'SELECT a.* FROM review_answers a JOIN review_items i ON i.id=a.item_id WHERE i.user_id=?',
    progress_events: 'SELECT * FROM progress_events WHERE user_id=?',
    conversations: 'SELECT * FROM conversations WHERE user_id=?',
    conversation_messages: 'SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=?',
    updates: 'SELECT u.* FROM updates u JOIN journeys j ON j.id=u.journey_id WHERE j.user_id=?',
    subscription: 'SELECT * FROM subscriptions WHERE user_id=?',
    usage: 'SELECT * FROM usage WHERE user_id=?',
  };
  const out: Record<string, unknown> = { exported_at: nowIso(), format: 'manara-export-v1' };
  for (const [k, sql] of Object.entries(tables)) out[k] = q.all(sql, userId);
  return out;
}

export function deleteUser(userId: string) {
  q.run('DELETE FROM users WHERE id=?', userId); // cascades to everything the user owns
}
