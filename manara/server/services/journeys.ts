import { q } from '../db.ts';
import { HttpError, newId, nowIso, parseJson } from '../util.ts';
import { aiMode, llm } from '../ai/llm.ts';
import { aiTurn, defaultQuestion, helpFor, missingSlots, ruleExtract, type InterviewState, type Lang, type NextQuestion, type SlotKey, type Slots } from '../ai/interview.ts';
import { analyzeGoal, buildPlan, ruleChange, understandChange, type Change, type Goal, type Plan } from '../ai/planner.ts';
import { webResearch, databaseResearch, relevant } from '../ai/research.ts';
import { storeSources } from './sources.ts';
import { runJob } from './jobs.ts';
import { checkLimit, recordUsage, getSubscription } from '../limits.ts';
import { ensureLessonReady } from './lessons.ts';

export type JourneyRow = {
  id: string;
  user_id: string;
  topic: string;
  title: string | null;
  status: string;
  interview_json: string;
  goal_json: string | null;
  plan_json: string | null;
  pending_change_json: string | null;
  map_model: string;
  ai_mode: string;
  created_at: string;
  started_at: string | null;
  last_active_at: string | null;
};

export type PlanMeta = {
  title: string;
  overview: string;
  review_policy: string;
  updates_policy: string | null;
  total_lessons: number;
  lessons_per_week: number;
  error?: string;
};

export const LESSONS_PER_WEEK = 5; // leaves room for rest and review days

export function getJourney(userId: string, id: string): JourneyRow {
  const j = q.get<JourneyRow>('SELECT * FROM journeys WHERE id=? AND user_id=?', id, userId);
  if (!j) throw new HttpError(404, 'journey_not_found');
  return j;
}

export const journeyLang = (j: JourneyRow): Lang => (parseJson<{ lang?: Lang }>(j.interview_json, {}).lang ?? 'ar');
export const interviewOf = (j: JourneyRow) => parseJson<InterviewState & { lang: Lang }>(j.interview_json, { slots: {}, history: [], current: 'topic', lang: 'ar' });

function saveInterview(id: string, st: InterviewState & { lang: Lang }) {
  q.run('UPDATE journeys SET interview_json=?, topic=? WHERE id=?', JSON.stringify(st), st.slots.topic ?? '', id);
}

function conversationId(userId: string, journeyId: string, kind: 'interview' | 'tutor', lessonId: string | null = null): string {
  const c = q.get<{ id: string }>(
    `SELECT id FROM conversations WHERE user_id=? AND journey_id=? AND kind=? AND ${lessonId ? 'lesson_id=?' : 'lesson_id IS NULL'}`,
    ...([userId, journeyId, kind, ...(lessonId ? [lessonId] : [])] as string[]),
  );
  if (c) return c.id;
  const id = newId('c_');
  q.run('INSERT INTO conversations(id,user_id,journey_id,lesson_id,kind,created_at) VALUES (?,?,?,?,?,?)', id, userId, journeyId, lessonId, kind, nowIso());
  return id;
}
export { conversationId };

export function addMessage(convId: string, role: 'user' | 'assistant', content: string, meta?: unknown) {
  q.run('INSERT INTO conversation_messages(id,conversation_id,role,content,meta_json,created_at) VALUES (?,?,?,?,?,?)', newId('m_'), convId, role, content, meta ? JSON.stringify(meta) : null, nowIso());
}

export function messagesOf(convId: string) {
  return q.all<{ id: string; role: string; content: string; meta_json: string | null; created_at: string }>(
    'SELECT id,role,content,meta_json,created_at FROM conversation_messages WHERE conversation_id=? ORDER BY created_at, rowid', convId,
  ).map((m) => ({ ...m, meta: parseJson(m.meta_json, null) }));
}

/* ------------------------------ Interview ------------------------------ */

export function createJourney(userId: string, lang: Lang) {
  const sub = getSubscription(userId);
  const count = q.get<{ n: number }>("SELECT COUNT(*) n FROM journeys WHERE user_id=? AND status NOT IN ('archived')", userId)!.n;
  if (count >= sub.planInfo.journeys) throw new HttpError(429, 'limit_journeys');
  const id = newId('j_');
  const first = defaultQuestion('topic', lang, {});
  const st: InterviewState & { lang: Lang } = { slots: {}, history: [], current: 'topic', currentQuestion: { text: first.text, options: first.options }, lang };
  q.run(
    'INSERT INTO journeys(id,user_id,topic,status,interview_json,ai_mode,created_at,last_active_at) VALUES (?,?,?,?,?,?,?,?)',
    id, userId, '', 'interviewing', JSON.stringify(st), aiMode(), nowIso(), nowIso(),
  );
  const conv = conversationId(userId, id, 'interview');
  addMessage(conv, 'assistant', first.text, { question: first });
  return { id, question: first };
}

function questionFor(st: InterviewState & { lang: Lang }, slot: SlotKey, aiText?: string | null, aiOptions?: string[]): NextQuestion {
  const base = defaultQuestion(slot, st.lang, st.slots);
  // Keep canonical option values (for reliable mapping) and use AI-adapted text when present.
  if (aiText) base.text = aiText;
  if (aiOptions?.length && !base.options.length) base.options = aiOptions.slice(0, 5).map((o) => ({ value: o, label: o }));
  return base;
}

export async function interviewAnswer(userId: string, journeyId: string, text: string, choice?: string) {
  const j = getJourney(userId, journeyId);
  if (j.status !== 'interviewing') throw new HttpError(409, 'interview_finished');
  const st = interviewOf(j);
  const slot = st.current;
  if (!slot) throw new HttpError(409, 'interview_finished');
  const answer = (text || '').trim().slice(0, 2000);
  if (!answer && !choice) throw new HttpError(400, 'empty_answer');
  const conv = conversationId(userId, journeyId, 'interview');
  const label = choice ? (st.currentQuestion?.options.find((o) => o.value === choice)?.label ?? answer) : answer;
  addMessage(conv, 'user', label);

  let updates: Partial<Slots> = ruleExtract(slot, answer || label, choice);
  let clarification: string | null = null;
  let ack = '';
  let aiNext: { text: string | null; options: string[] } = { text: null, options: [] };

  // With AI: understand free text (several slots at once, clarification, natural phrasing).
  if (aiMode() === 'anthropic' && !choice) {
    try {
      const r = await aiTurn(llm(), st.lang, st, answer);
      updates = { ...updates, ...r.updates };
      clarification = r.clarification;
      ack = r.ack;
      aiNext = { text: r.nextText, options: r.nextOptions };
    } catch {
      /* rule-based result is used */
    }
  }
  const prevSlots = { ...st.slots };
  if (!clarification && (updates as Record<string, unknown>)[slot] === undefined) {
    // Could not understand the answer for this question.
    if (QUESTION_NEEDS_STRUCTURE.includes(slot)) {
      clarification = st.lang === 'ar' ? `لم أتأكد من فهم إجابتك. ${helpFor(slot, st.lang)}` : `I am not sure I understood. ${helpFor(slot, st.lang)}`;
    } else (updates as Record<string, unknown>)[slot] = answer;
  }

  if (clarification) {
    const q2 = { ...questionFor(st, slot), text: clarification };
    addMessage(conv, 'assistant', clarification, { question: q2, clarification: true });
    return { done: false, question: q2, ack: null };
  }

  st.slots = { ...st.slots, ...updates };
  st.history.push({ slot, question: st.currentQuestion?.text ?? '', answer: label, prevSlots });
  const missing = missingSlots(st.slots);
  if (!missing.length) {
    st.current = null;
    saveInterview(journeyId, st);
    if (ack) addMessage(conv, 'assistant', ack);
    return finishInterview(userId, journeyId);
  }
  const next = missing[0];
  const nq = questionFor(st, next, aiNext.text, aiNext.options);
  st.current = next;
  st.currentQuestion = { text: nq.text, options: nq.options };
  saveInterview(journeyId, st);
  addMessage(conv, 'assistant', ack ? `${ack}\n${nq.text}` : nq.text, { question: nq });
  return { done: false, question: nq, ack };
}

const QUESTION_NEEDS_STRUCTURE: SlotKey[] = ['minutes_per_day', 'duration_weeks', 'depth', 'detail', 'source_pref', 'follow_updates'];

/** Go back one question; the previous answer can be changed. */
export function interviewBack(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  if (!['interviewing', 'confirming'].includes(j.status)) throw new HttpError(409, 'interview_finished');
  const last = st.history.pop();
  if (!last) return { question: questionFor(st, st.current ?? 'topic') };
  st.slots = last.prevSlots;
  st.current = last.slot;
  const nq = questionFor(st, last.slot);
  st.currentQuestion = { text: nq.text, options: nq.options };
  saveInterview(journeyId, st);
  q.run("UPDATE journeys SET status='interviewing', goal_json=NULL WHERE id=?", journeyId);
  const conv = conversationId(userId, journeyId, 'interview');
  addMessage(conv, 'assistant', nq.text, { question: nq, back: true });
  return { question: nq };
}

export function interviewHelp(userId: string, journeyId: string) {
  const st = interviewOf(getJourney(userId, journeyId));
  const slot = st.current ?? 'topic';
  const text = helpFor(slot, st.lang);
  addMessage(conversationId(userId, journeyId, 'interview'), 'assistant', text, { help: true });
  return { text };
}

async function finishInterview(userId: string, journeyId: string) {
  q.run("UPDATE journeys SET status='confirming' WHERE id=?", journeyId);
  return { done: true, ...(await reviseGoal(userId, journeyId)) };
}

export function goalFallback(lang: Lang, s: Slots): Goal {
  const depth = { general: lang === 'ar' ? 'معرفة عامة متينة' : 'solid general knowledge', deep: lang === 'ar' ? 'تخصصًا عميقًا' : 'deep specialisation', research: lang === 'ar' ? 'إعدادًا بحثيًا' : 'research preparation' }[s.depth ?? 'general'] ?? '';
  return {
    statement:
      lang === 'ar'
        ? `فهمت أنك تريد ${depth} في «${s.topic}»${s.outcome ? `، لتصل إلى: ${s.outcome}` : ''}، بجرعة ${s.minutes_per_day} دقيقة يوميًا على مدى ${s.duration_weeks} أسبوعًا. هل هذا ما تقصده؟`
        : `I understand you want ${depth} in "${s.topic}"${s.outcome ? `, aiming to: ${s.outcome}` : ''}, ${s.minutes_per_day} minutes a day over ${s.duration_weeks} weeks. Is that right?`,
    title: s.topic ?? '',
    scope_in: [],
    scope_out: [],
    prerequisites: [],
    field_nature: 'mixed',
    map_model: 'tree',
    start_level: s.prior_knowledge === 'advanced' ? 'advanced' : s.prior_knowledge === 'intermediate' ? 'intermediate' : 'foundations',
  };
}

export async function reviseGoal(userId: string, journeyId: string, correction?: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  const prev = parseJson<Goal | null>(j.goal_json, null);
  let goal: Goal;
  if (aiMode() === 'off') {
    goal = goalFallback(st.lang, st.slots);
    if (correction) goal.statement = (st.lang === 'ar' ? `تعديلك: ${correction}\n` : `Your correction: ${correction}\n`) + goal.statement;
  } else goal = await analyzeGoal(llm(), st.lang, st.slots, correction, prev ?? undefined);
  q.run('UPDATE journeys SET goal_json=?, title=?, map_model=?, status=? WHERE id=?', JSON.stringify(goal), goal.title, goal.map_model, 'confirming', journeyId);
  const conv = conversationId(userId, journeyId, 'interview');
  if (correction) addMessage(conv, 'user', correction);
  addMessage(conv, 'assistant', goal.statement, { goal: true });
  return { goal };
}

/* ------------------------------ Planning ------------------------------ */

export function acceptGoal(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  if (j.status !== 'confirming' && j.status !== 'proposed' && j.status !== 'plan_failed') throw new HttpError(409, 'bad_state');
  checkLimit(userId, 'plans');
  q.run("UPDATE journeys SET status='planning' WHERE id=?", journeyId);
  void runJob(`plan:${journeyId}`, () => planJourney(userId, journeyId));
  return { status: 'planning' };
}

async function planJourney(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  const goal = parseJson<Goal>(j.goal_json, goalFallback(st.lang, st.slots));
  try {
    if (aiMode() === 'off') throw new HttpError(503, 'ai_not_configured');
    // 1) Research the field map and foundational sources first: the plan rests on sources, not wording.
    let notes = '';
    const sids: { sid: string; id: string; title: string; kind: string; year?: string; authors?: string }[] = [];
    if (aiMode() === 'anthropic') {
      const [web, dbHits] = await Promise.all([
        webResearch(llm(), {
          topic: `${st.slots.topic}: map of the field, foundational works, main schools and current research`,
          focus: `${goal.statement}\nScope: ${goal.scope_in.join('; ')}. Exclude: ${goal.scope_out.join('; ')}`,
          lang: st.lang,
          goal: goal.statement,
          level: st.slots.prior_knowledge ?? '',
          sourcePref: st.slots.source_pref ?? 'both',
          maxSearches: 6,
        }),
        databaseResearch(st.slots.topic ?? '', st.lang, st.slots.source_pref ?? 'both'),
      ]);
      recordUsage(userId, 'research');
      notes = web.notes;
      const terms = (st.slots.topic ?? '').split(/\s+/);
      const stored = await storeSources(journeyId, [...web.sources, ...dbHits.filter((s) => relevant(s, terms))]);
      stored.forEach((s, i) => sids.push({ sid: `S${i + 1}`, id: s.id, title: s.title, kind: s.kind, year: s.year ?? undefined, authors: s.authors ?? undefined }));
    }
    const plan = await buildPlan(llm(), { lang: st.lang, slots: st.slots, goal, notes, sources: sids.map(({ id: _id, ...r }) => r) });
    recordUsage(userId, 'plans');
    q.tx(() => persistPlan(journeyId, plan, st.slots, new Map(sids.map((s) => [s.sid, s.id]))));
    q.run("UPDATE journeys SET status='proposed', title=? WHERE id=?", plan.title, journeyId);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 'plan_failed';
    q.run("UPDATE journeys SET status='plan_failed', plan_json=? WHERE id=?", JSON.stringify({ error: code }), journeyId);
    throw e;
  }
}

/** Persist stages/nodes/relations and lay out the daily lesson sequence. Keeps done work. */
export function persistPlan(journeyId: string, plan: Plan, slots: Slots, sidMap: Map<string, string>, keepDone = false) {
  // Nodes the learner has already studied (any read lesson) are kept with their lessons.
  const doneByTitle = new Map<string, { id: string }>();
  if (keepDone) {
    q.run("UPDATE nodes SET parent_id=NULL WHERE journey_id=? AND id IN (SELECT node_id FROM lessons WHERE status='read')", journeyId);
    q.run("DELETE FROM lessons WHERE journey_id=? AND status<>'read'", journeyId);
    q.run('DELETE FROM nodes WHERE journey_id=? AND id NOT IN (SELECT node_id FROM lessons WHERE journey_id=?)', journeyId, journeyId);
    for (const n of q.all<{ id: string; title: string }>('SELECT id,title FROM nodes WHERE journey_id=?', journeyId)) doneByTitle.set(n.title.trim(), n);
  } else {
    q.run('DELETE FROM lessons WHERE journey_id=?', journeyId);
    q.run('DELETE FROM nodes WHERE journey_id=?', journeyId);
  }
  q.run('DELETE FROM relations WHERE journey_id=?', journeyId);
  q.run('DELETE FROM stages WHERE journey_id=?', journeyId);
  // Stage lengths are scaled so they add up to the learner's chosen duration.
  const totalWeeks = plan.stages.reduce((a, s) => a + Math.max(0.5, s.weeks), 0) || 1;
  const stageIds = plan.stages.map((s, i) => {
    const id = newId('st_');
    const weeks = Math.max(1, Math.round((Math.max(0.5, s.weeks) / totalWeeks) * (slots.duration_weeks ?? totalWeeks)));
    q.run('INSERT INTO stages(id,journey_id,idx,title,description,weeks) VALUES (?,?,?,?,?,?)', id, journeyId, i, s.title, s.description, weeks);
    return id;
  });
  const keyToId = new Map<string, string>();
  for (const n of plan.nodes) {
    const kept = doneByTitle.get(n.title.trim());
    keyToId.set(n.key, kept?.id ?? newId('n_'));
  }
  // Insert parents before children.
  const ordered: Plan['nodes'] = [];
  const pending = [...plan.nodes];
  const placed = new Set<string>();
  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; i++) {
      const n = pending[i];
      if (!n.parent_key || placed.has(n.parent_key) || !keyToId.has(n.parent_key)) {
        ordered.push(n);
        placed.add(n.key);
        pending.splice(i--, 1);
      }
    }
    if (pending.length === before) {
      ordered.push(...pending.map((n) => ({ ...n, parent_key: null })));
      break;
    }
  }
  const reused = new Set<string>();
  ordered.forEach((n, i) => {
    const id = keyToId.get(n.key)!;
    const stageId = stageIds[Math.min(Math.max(0, Math.round(n.stage_index)), stageIds.length - 1)] ?? null;
    const parent = n.parent_key && keyToId.has(n.parent_key) && n.parent_key !== n.key ? keyToId.get(n.parent_key)! : null;
    if (doneByTitle.get(n.title.trim())) {
      q.run('UPDATE nodes SET parent_id=?, stage_id=?, order_idx=?, lesson_order=? WHERE id=?', parent, stageId, i, n.teach ? Math.max(1, Math.min(5, Math.round(n.weight))) : null, id);
      reused.add(id);
      return;
    }
    q.run(
      'INSERT INTO nodes(id,journey_id,stage_id,parent_id,kind,title,summary,order_idx,status,search_queries,lesson_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, journeyId, stageId, parent, n.kind, n.title, n.summary, i, 'upcoming', JSON.stringify(n.search_queries), n.teach ? Math.max(1, Math.min(5, Math.round(n.weight))) : null,
    );
    for (const sid of n.source_ids) {
      const srcId = sidMap.get(sid);
      if (srcId) q.run('INSERT OR IGNORE INTO node_sources(node_id,source_id) VALUES (?,?)', id, srcId);
    }
  });
  // Studied nodes that are no longer part of the plan stay visible (history) but get no new lessons.
  for (const kept of doneByTitle.values()) if (!reused.has(kept.id)) q.run('UPDATE nodes SET lesson_order=NULL, order_idx=-1 WHERE id=?', kept.id);
  for (const r of plan.relations) {
    const a = keyToId.get(r.from);
    const b = keyToId.get(r.to);
    if (a && b && a !== b) q.run('INSERT INTO relations(id,journey_id,from_node,to_node,type,note) VALUES (?,?,?,?,?,?)', newId('r_'), journeyId, a, b, r.type, r.note);
  }
  layoutLessons(journeyId, slots);
  const total = q.get<{ n: number }>('SELECT COUNT(*) n FROM lessons WHERE journey_id=?', journeyId)!.n;
  const meta: PlanMeta = { title: plan.title, overview: plan.overview, review_policy: plan.review_policy, updates_policy: plan.updates_policy, total_lessons: total, lessons_per_week: LESSONS_PER_WEEK };
  q.run('UPDATE journeys SET plan_json=? WHERE id=?', JSON.stringify(meta), journeyId);
}

/**
 * Daily sequence: teachable nodes in stage order then tree order (parents first),
 * each node getting a number of lessons proportional to its weight, scaled so the
 * total fits duration × lessons/week. Already-read lessons are kept.
 */
export function layoutLessons(journeyId: string, slots: Slots) {
  type N = { id: string; parent_id: string | null; title: string; lesson_order: number; stage_idx: number; order_idx: number; status: string };
  const nodes = q.all<N>(
    `SELECT n.id,n.parent_id,n.title,n.lesson_order,COALESCE(s.idx,0) stage_idx,n.order_idx,n.status FROM nodes n LEFT JOIN stages s ON s.id=n.stage_id
     WHERE n.journey_id=? AND n.lesson_order IS NOT NULL AND n.status<>'skipped' ORDER BY stage_idx, n.order_idx`,
    journeyId,
  );
  const target = Math.max(nodes.length, Math.round((slots.duration_weeks ?? 12) * LESSONS_PER_WEEK));
  const totalWeight = nodes.reduce((a, n) => a + n.lesson_order, 0) || 1;
  const readCounts = new Map(q.all<{ node_id: string; n: number }>("SELECT node_id, COUNT(*) n FROM lessons WHERE journey_id=? AND status='read' GROUP BY node_id", journeyId).map((r) => [r.node_id, r.n]));
  q.run("DELETE FROM lessons WHERE journey_id=? AND status NOT IN ('read','ready')", journeyId);
  const readyCounts = new Map(q.all<{ node_id: string; n: number }>("SELECT node_id, COUNT(*) n FROM lessons WHERE journey_id=? AND status='ready' GROUP BY node_id", journeyId).map((r) => [r.node_id, r.n]));
  let seq = 0;
  // Keep read lessons first (history), then everything else in plan order.
  for (const l of q.all<{ id: string }>("SELECT id FROM lessons WHERE journey_id=? AND status='read' ORDER BY read_at", journeyId)) q.run('UPDATE lessons SET seq=? WHERE id=?', ++seq, l.id);
  for (const n of nodes) {
    const want = Math.max(1, Math.round((n.lesson_order / totalWeight) * target));
    const have = (readCounts.get(n.id) ?? 0);
    const ready = q.all<{ id: string }>("SELECT id FROM lessons WHERE node_id=? AND status='ready' ORDER BY seq", n.id);
    for (const l of ready) q.run('UPDATE lessons SET seq=? WHERE id=?', ++seq, l.id);
    for (let k = have + (readyCounts.get(n.id) ?? 0); k < want; k++) {
      q.run(
        'INSERT INTO lessons(id,journey_id,node_id,seq,title,status,minutes) VALUES (?,?,?,?,?,?,?)',
        newId('l_'), journeyId, n.id, ++seq, want > 1 ? `${n.title} (${k + 1}/${want})` : n.title, 'planned', slots.minutes_per_day ?? 10,
      );
    }
  }
}

export function approvePlan(userId: string, journeyId: string) {
  const j = getJourney(userId, journeyId);
  if (j.status !== 'proposed') throw new HttpError(409, 'bad_state');
  q.run("UPDATE journeys SET status='active', started_at=?, last_active_at=? WHERE id=?", nowIso(), nowIso(), journeyId);
  const first = q.get<{ id: string }>('SELECT id FROM lessons WHERE journey_id=? ORDER BY seq LIMIT 1', journeyId);
  if (first) void ensureLessonReady(userId, first.id).catch(() => undefined);
  return { status: 'active' };
}

/* ------------------------------ Plan changes ------------------------------ */

export async function requestChange(userId: string, journeyId: string, request: string) {
  const j = getJourney(userId, journeyId);
  if (!['active', 'proposed', 'paused'].includes(j.status)) throw new HttpError(409, 'bad_state');
  const st = interviewOf(j);
  let change: Change | null = ruleChange(request, st.slots, st.lang);
  if (aiMode() === 'anthropic') {
    try {
      change = await understandChange(llm(), st.lang, request, st.slots, j.title ?? '');
    } catch {
      /* keep rule-based */
    }
  } else if (!change && aiMode() === 'demo') {
    change = { summary: st.lang === 'ar' ? `(تجريبي) إعادة بناء الخطة وفق طلبك: ${request}` : `(demo) Re-plan per your request: ${request}`, major: true, settings: { minutes_per_day: null, duration_weeks: null, detail: null, depth: null, source_pref: null }, restructure: true, restructure_request: request };
  }
  if (!change) throw new HttpError(422, 'change_not_understood');
  if (change.major) {
    q.run('UPDATE journeys SET pending_change_json=? WHERE id=?', JSON.stringify({ ...change, request }), journeyId);
    return { applied: false, needsConfirmation: true, change };
  }
  await applyChange(userId, journeyId, change, request);
  return { applied: true, needsConfirmation: false, change };
}

export async function confirmChange(userId: string, journeyId: string, accept: boolean) {
  const j = getJourney(userId, journeyId);
  const pending = parseJson<(Change & { request: string }) | null>(j.pending_change_json, null);
  q.run('UPDATE journeys SET pending_change_json=NULL WHERE id=?', journeyId);
  if (!pending || !accept) return { applied: false };
  await applyChange(userId, journeyId, pending, pending.request);
  return { applied: true, change: pending };
}

/** Direct settings change from the preferences page (explicit user action, no AI needed unless re-planning). */
export async function updateSettings(userId: string, journeyId: string, settings: Partial<Change['settings']>) {
  const st = interviewOf(getJourney(userId, journeyId));
  const full: Change['settings'] = { minutes_per_day: null, duration_weeks: null, detail: null, depth: null, source_pref: null, ...settings };
  const ar = st.lang === 'ar';
  const parts: string[] = [];
  if (full.minutes_per_day) parts.push(ar ? `الجرعة اليومية ${full.minutes_per_day} دقيقة` : `${full.minutes_per_day} min a day`);
  if (full.duration_weeks) parts.push(ar ? `مدة الرحلة ${full.duration_weeks} أسبوعًا` : `${full.duration_weeks} weeks`);
  if (full.detail) parts.push(ar ? 'مستوى التفصيل' : 'detail level');
  if (full.depth) parts.push(ar ? 'العمق العلمي' : 'depth');
  if (full.source_pref) parts.push(ar ? 'تفضيل المصادر' : 'source preference');
  const summary = (ar ? 'حُدِّث: ' : 'Updated: ') + parts.join(ar ? '، ' : ', ');
  await applyChange(userId, journeyId, { summary, major: false, settings: full, restructure: false, restructure_request: null }, '');
  return { ok: true };
}

async function applyChange(userId: string, journeyId: string, change: Change, request: string) {
  const j = getJourney(userId, journeyId);
  const st = interviewOf(j);
  const s = change.settings;
  st.slots = {
    ...st.slots,
    ...(s.minutes_per_day ? { minutes_per_day: Math.max(3, Math.min(120, s.minutes_per_day)) } : {}),
    ...(s.duration_weeks ? { duration_weeks: Math.max(1, Math.min(156, s.duration_weeks)) } : {}),
    ...(s.detail ? { detail: s.detail } : {}),
    ...(s.depth ? { depth: s.depth } : {}),
    ...(s.source_pref ? { source_pref: s.source_pref } : {}),
  };
  saveInterview(journeyId, st);
  if (s.minutes_per_day) q.run("UPDATE lessons SET minutes=? WHERE journey_id=? AND status='planned'", st.slots.minutes_per_day!, journeyId);
  if (change.restructure || s.depth || s.source_pref) {
    checkLimit(userId, 'plans');
    const goal = parseJson<Goal>(j.goal_json, goalFallback(st.lang, st.slots));
    const current = {
      stages: q.all('SELECT title FROM stages WHERE journey_id=? ORDER BY idx', journeyId),
      nodes: q.all('SELECT title,kind,status FROM nodes WHERE journey_id=? ORDER BY order_idx', journeyId),
    };
    const plan = await buildPlan(llm(), { lang: st.lang, slots: st.slots, goal, notes: '', sources: [], changeRequest: change.restructure_request ?? request, currentPlan: current });
    recordUsage(userId, 'plans');
    q.tx(() => persistPlan(journeyId, plan, st.slots, new Map(), true));
  } else if (s.duration_weeks) {
    q.tx(() => layoutLessons(journeyId, st.slots));
    const total = q.get<{ n: number }>('SELECT COUNT(*) n FROM lessons WHERE journey_id=?', journeyId)!.n;
    const meta = parseJson<PlanMeta>(j.plan_json, {} as PlanMeta);
    q.run('UPDATE journeys SET plan_json=? WHERE id=?', JSON.stringify({ ...meta, total_lessons: total }), journeyId);
  }
  addMessage(conversationId(userId, journeyId, 'tutor'), 'assistant', change.summary, { planChange: true });
}
