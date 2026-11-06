import { q } from '../db.ts';
import { HttpError, newId, nowIso, parseJson } from '../util.ts';
import { aiMode, llm } from '../ai/llm.ts';
import { webResearch, databaseResearch, relevant } from '../ai/research.ts';
import { synthesizeLesson, type LessonDraft } from '../ai/synthesis.ts';
import { emptyReport, validateParagraph, type ExcerptIndex, type Paragraph } from '../ai/verify.ts';
import { storeSources, type SourceRow } from './sources.ts';
import { runJob, isRunning } from './jobs.ts';
import { checkLimit, recordUsage } from '../limits.ts';
import { getJourney, interviewOf, type JourneyRow } from './journeys.ts';
import type { Goal } from '../ai/planner.ts';

export type LessonRow = {
  id: string;
  journey_id: string;
  node_id: string;
  seq: number;
  title: string;
  key_question: string | null;
  status: string;
  error: string | null;
  minutes: number | null;
  saved: number;
  max_level_opened: number;
  content_mode: string | null;
  verification_json: string | null;
  generated_at: string | null;
  read_at: string | null;
};

const MAX_EXCERPTS = 36;
const wordsToMinutes = (s: string) => Math.max(1, Math.round(s.split(/\s+/).length / 150));

export function getLesson(userId: string, lessonId: string): LessonRow & { user_id: string } {
  const l = q.get<LessonRow & { user_id: string }>('SELECT l.*, j.user_id FROM lessons l JOIN journeys j ON j.id=l.journey_id WHERE l.id=?', lessonId);
  if (!l || l.user_id !== userId) throw new HttpError(404, 'lesson_not_found');
  return l;
}

/** Make sure a lesson has content; starts generation in the background if needed. */
export async function ensureLessonReady(userId: string, lessonId: string, wait = false) {
  const l = getLesson(userId, lessonId);
  if (l.status === 'ready' || l.status === 'read') return l;
  if (!isRunning(`lesson:${lessonId}`)) {
    checkLimit(userId, 'lessons');
    q.run("UPDATE lessons SET status='generating', error=NULL WHERE id=?", lessonId);
  }
  const p = runJob(`lesson:${lessonId}`, () => generateLesson(userId, lessonId));
  if (wait) await p;
  return getLesson(userId, lessonId);
}

async function generateLesson(userId: string, lessonId: string) {
  const l = getLesson(userId, lessonId);
  const j = getJourney(userId, l.journey_id);
  const st = interviewOf(j);
  const goal = parseJson<Goal | null>(j.goal_json, null);
  const node = q.get<{ id: string; title: string; summary: string; search_queries: string | null }>('SELECT id,title,summary,search_queries FROM nodes WHERE id=?', l.node_id)!;
  const siblings = q.all<{ id: string; title: string; status: string; key_question: string | null }>('SELECT id,title,status,key_question FROM lessons WHERE node_id=? ORDER BY seq', l.node_id);
  const part = siblings.findIndex((s) => s.id === lessonId) + 1;
  try {
    if (aiMode() === 'off') throw new HttpError(503, 'ai_not_configured');
    // 1) Gather sources: node sources from planning + fresh research for this unit.
    const sources: SourceRow[] = q.all<SourceRow>('SELECT s.* FROM sources s JOIN node_sources ns ON ns.source_id=s.id WHERE ns.node_id=?', node.id);
    let notes = '';
    if (aiMode() === 'anthropic') {
      checkLimit(userId, 'research');
      const queries = parseJson<string[]>(node.search_queries, []);
      const [web, dbHits] = await Promise.all([
        webResearch(llm(), {
          topic: siblings.length > 1 ? `${node.title} — part ${part}/${siblings.length}` : node.title,
          focus: `${node.summary}${queries.length ? `\nSuggested queries: ${queries.join(' | ')}` : ''}`,
          lang: st.lang,
          goal: goal?.statement ?? st.slots.topic ?? '',
          level: st.slots.prior_knowledge ?? '',
          sourcePref: st.slots.source_pref ?? 'both',
        }),
        databaseResearch(queries[0] ?? node.title, st.lang, st.slots.source_pref ?? 'both'),
      ]);
      recordUsage(userId, 'research');
      notes = web.notes;
      const terms = [...node.title.split(/\s+/), ...(st.slots.topic ?? '').split(/\s+/)];
      const stored = await storeSources(j.id, [...web.sources, ...dbHits.filter((s) => relevant(s, terms))]);
      for (const s of stored) {
        if (!sources.some((x) => x.id === s.id)) sources.push(s);
        q.run('INSERT OR IGNORE INTO node_sources(node_id,source_id) VALUES (?,?)', node.id, s.id);
      }
    }
    // 2) Evidence index: verbatim excerpts only.
    const sid = new Map<string, string>(); // source id -> S#
    sources.forEach((s, i) => sid.set(s.id, `S${i + 1}`));
    const excerptRows = sources.flatMap((s) =>
      q.all<{ id: string; source_id: string; text: string }>('SELECT id,source_id,text FROM excerpts WHERE source_id=? ORDER BY rowid DESC LIMIT 6', s.id),
    ).slice(0, MAX_EXCERPTS);
    const index: ExcerptIndex = new Map();
    excerptRows.forEach((e, i) => index.set(`E${i + 1}`, { excerptId: e.id, sourceId: e.source_id, text: e.text }));
    if (aiMode() === 'anthropic' && index.size === 0) throw new HttpError(422, 'no_sources');

    // 3) Synthesis.
    const previousLessons = q.all<{ title: string; id: string }>("SELECT title,id FROM lessons WHERE journey_id=? AND status IN ('read','ready') AND seq < ? ORDER BY seq", j.id, l.seq).map((p) => ({
      title: p.title,
      concepts: q.all<{ term: string }>('SELECT term FROM concepts WHERE lesson_id=?', p.id).map((c) => c.term),
    }));
    const draft = await synthesizeLesson(llm(), {
      lang: st.lang,
      goal: goal?.statement ?? '',
      detail: st.slots.detail ?? 'medium',
      level: st.slots.prior_knowledge ?? '',
      nodeTitle: node.title,
      nodeSummary: node.summary ?? '',
      part,
      parts: siblings.length,
      previousParts: siblings.filter((s) => s.id !== lessonId && s.status !== 'planned').map((s) => s.key_question ?? s.title),
      previousLessons,
      notes,
      sources: sources.map((s) => ({ sid: sid.get(s.id)!, title: s.title, kind: s.kind, authors: s.authors, year: s.year, primary: !!s.is_primary })),
      excerpts: [...index.entries()].map(([eid, e]) => ({ eid, sid: sid.get(e.sourceId)!, text: e.text })),
    });
    recordUsage(userId, 'lessons');
    q.tx(() => saveLesson(userId, j, l, draft, index, new Map([...sid.entries()].map(([id, s]) => [s, id]))));
  } catch (e) {
    q.run("UPDATE lessons SET status='failed', error=? WHERE id=?", e instanceof HttpError ? e.code : 'generation_failed', lessonId);
    throw e;
  }
}

function saveLesson(userId: string, j: JourneyRow, l: LessonRow, d: LessonDraft, index: ExcerptIndex, sidToId: Map<string, string>) {
  const report = emptyReport();
  const mapCites = (cites: string[]) => cites.filter((c) => index.has(c)).map((c) => index.get(c)!.excerptId);
  const fix = (ps: Paragraph[]) =>
    ps.map((p) => validateParagraph(p, index, report)).map((p) => ({ ...p, cites: mapCites(p.cites), quote: p.quote ? { text: p.quote.text, cite: index.get(p.quote.cite)!.excerptId } : null }));

  const summary = fix(d.summary);
  const background = fix(d.background);
  const evidence = fix(d.evidence);
  const concepts = d.concepts.map((c) => ({ term: c.term, definition: c.definition, cites: mapCites(c.cites) }));
  const positions = d.positions.map((p) => ({ ...p, cites: mapCites(p.cites), unsupported: mapCites(p.cites).length === 0 }));
  const further = d.further_reading.filter((f) => sidToId.has(f.sid)).map((f) => ({ sourceId: sidToId.get(f.sid)!, why: f.why, locator: f.locator }));

  q.run('DELETE FROM lesson_sections WHERE lesson_id=?', l.id);
  q.run('DELETE FROM concepts WHERE lesson_id=?', l.id);
  q.run('DELETE FROM source_refs WHERE lesson_id=?', l.id);
  q.run('DELETE FROM review_items WHERE lesson_id=?', l.id);
  const sec = (level: number, kind: string, title: string, body: unknown, text: string) =>
    q.run('INSERT INTO lesson_sections(id,lesson_id,level,kind,title,minutes,body_json) VALUES (?,?,?,?,?,?,?)', newId('ls_'), l.id, level, kind, title, wordsToMinutes(text), JSON.stringify(body));
  const ar = interviewOf(j).lang === 'ar';
  const join = (ps: { text: string }[]) => ps.map((p) => p.text).join(' ');
  sec(1, 'summary', ar ? 'الخلاصة' : 'Summary', { paragraphs: summary, links: d.links_to_previous, uncertainty: d.uncertainty_note }, join(summary));
  sec(2, 'concepts', ar ? 'المفاهيم' : 'Key concepts', { concepts }, concepts.map((c) => c.definition).join(' '));
  sec(3, 'background', ar ? 'الخلفية التاريخية والفكرية' : 'Background', { paragraphs: background }, join(background));
  sec(4, 'evidence', ar ? 'الأدلة والمناقشات' : 'Evidence and debates', { paragraphs: evidence, positions }, join(evidence) + positions.map((p) => p.arguments).join(' '));
  sec(5, 'sources', ar ? 'المصادر والتوسع' : 'Sources and further study', { further }, further.map((f) => f.why).join(' '));

  for (const c of concepts) q.run('INSERT INTO concepts(id,journey_id,lesson_id,term,definition) VALUES (?,?,?,?,?)', newId('k_'), j.id, l.id, c.term, c.definition);
  const usedExcerpts = new Set<string>([...summary, ...background, ...evidence].flatMap((p) => p.cites).concat(concepts.flatMap((c) => c.cites), positions.flatMap((p) => p.cites)));
  const usedSources = new Set<string>(further.map((f) => f.sourceId));
  for (const e of index.values()) if (usedExcerpts.has(e.excerptId)) usedSources.add(e.sourceId);
  for (const sId of usedSources) {
    const ex = [...index.values()].filter((e) => e.sourceId === sId && usedExcerpts.has(e.excerptId));
    if (!ex.length) q.run('INSERT INTO source_refs(id,lesson_id,source_id,excerpt_id) VALUES (?,?,?,NULL)', newId('sr_'), l.id, sId);
    for (const e of ex) q.run('INSERT INTO source_refs(id,lesson_id,source_id,excerpt_id) VALUES (?,?,?,?)', newId('sr_'), l.id, sId, e.excerptId);
  }
  const due = new Date(Date.now() + 86400000).toISOString();
  for (const rq of d.review_questions.slice(0, 5)) {
    q.run(
      'INSERT INTO review_items(id,user_id,journey_id,lesson_id,node_id,question,answer,kind,due_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      newId('ri_'), userId, j.id, l.id, l.node_id, rq.question, rq.answer, 'recall', due, nowIso(),
    );
  }
  const minutes = wordsToMinutes(join(summary));
  q.run(
    "UPDATE lessons SET title=?, key_question=?, status='ready', error=NULL, content_mode=?, verification_json=?, generated_at=?, minutes=? WHERE id=?",
    d.title, d.key_question, aiMode(), JSON.stringify(report), nowIso(), minutes, l.id,
  );
  q.run("UPDATE nodes SET status='current' WHERE id=? AND status='upcoming'", l.node_id);
}

/** Full lesson payload for the reader. */
export function lessonPayload(userId: string, lessonId: string) {
  const l = getLesson(userId, lessonId);
  const sections = q.all<{ level: number; kind: string; title: string; minutes: number; body_json: string }>('SELECT level,kind,title,minutes,body_json FROM lesson_sections WHERE lesson_id=? ORDER BY level', lessonId).map((s) => ({
    level: s.level,
    kind: s.kind,
    title: s.title,
    minutes: s.minutes,
    body: parseJson(s.body_json, {}),
  }));
  const sources = q.all<SourceRow>('SELECT DISTINCT s.* FROM sources s JOIN source_refs r ON r.source_id=s.id WHERE r.lesson_id=? ORDER BY s.is_primary DESC, s.title', lessonId);
  const excerpts = q.all<{ id: string; source_id: string; text: string; locator: string | null; origin: string }>(
    'SELECT DISTINCT e.id,e.source_id,e.text,e.locator,e.origin FROM excerpts e JOIN source_refs r ON r.excerpt_id=e.id WHERE r.lesson_id=?',
    lessonId,
  );
  const node = q.get<{ id: string; title: string; stage: string | null; stage_idx: number | null }>('SELECT n.id,n.title,s.title stage,s.idx stage_idx FROM nodes n LEFT JOIN stages s ON s.id=n.stage_id WHERE n.id=?', l.node_id);
  const total = q.get<{ n: number }>('SELECT COUNT(*) n FROM lessons WHERE journey_id=?', l.journey_id)!.n;
  const notes = q.all('SELECT id,body,created_at FROM notes WHERE lesson_id=? AND user_id=? ORDER BY created_at DESC', lessonId, userId);
  const next = q.get<{ id: string }>('SELECT id FROM lessons WHERE journey_id=? AND seq>? ORDER BY seq LIMIT 1', l.journey_id, l.seq);
  const prev = q.get<{ id: string }>('SELECT id FROM lessons WHERE journey_id=? AND seq<? ORDER BY seq DESC LIMIT 1', l.journey_id, l.seq);
  return {
    lesson: { ...l, user_id: undefined, verification: parseJson(l.verification_json, null) },
    sections,
    sources,
    excerpts,
    node,
    position: { seq: l.seq, total },
    notes,
    nextId: next?.id ?? null,
    prevId: prev?.id ?? null,
  };
}

export function openLevel(userId: string, lessonId: string, level: number) {
  const l = getLesson(userId, lessonId);
  if (level > l.max_level_opened) {
    q.run('UPDATE lessons SET max_level_opened=? WHERE id=?', Math.min(5, level), lessonId);
    q.run('INSERT INTO progress_events(id,user_id,journey_id,lesson_id,kind,seconds,created_at) VALUES (?,?,?,?,?,?,?)', newId('pe_'), userId, l.journey_id, lessonId, 'more', 0, nowIso());
  }
}

export function markRead(userId: string, lessonId: string, seconds: number) {
  const l = getLesson(userId, lessonId);
  if (l.status !== 'ready' && l.status !== 'read') throw new HttpError(409, 'lesson_not_ready');
  q.run("UPDATE lessons SET status='read', read_at=COALESCE(read_at, ?) WHERE id=?", nowIso(), lessonId);
  q.run('INSERT INTO progress_events(id,user_id,journey_id,lesson_id,kind,seconds,created_at) VALUES (?,?,?,?,?,?,?)', newId('pe_'), userId, l.journey_id, lessonId, 'read', Math.max(0, Math.min(7200, Math.round(seconds))), nowIso());
  q.run('UPDATE journeys SET last_active_at=? WHERE id=?', nowIso(), l.journey_id);
  const left = q.get<{ n: number }>("SELECT COUNT(*) n FROM lessons WHERE node_id=? AND status<>'read'", l.node_id)!.n;
  q.run(`UPDATE nodes SET status=?, mastery=MAX(mastery, ?) WHERE id=?`, left === 0 ? 'done' : 'current', left === 0 ? 0.6 : 0.3, l.node_id);
  // Prefetch the next lesson so tomorrow's dose is ready.
  const next = q.get<{ id: string; status: string }>('SELECT id,status FROM lessons WHERE journey_id=? AND seq>? ORDER BY seq LIMIT 1', l.journey_id, l.seq);
  if (next && next.status === 'planned') void ensureLessonReady(userId, next.id).catch(() => undefined);
  return { nextId: next?.id ?? null };
}

/** The lesson for "today": the first unread lesson in sequence. */
export function todayLesson(journeyId: string) {
  return q.get<LessonRow>("SELECT * FROM lessons WHERE journey_id=? AND status<>'read' ORDER BY seq LIMIT 1", journeyId) ?? null;
}

export function lessonPlainText(lessonId: string) {
  const secs = q.all<{ title: string; body_json: string }>('SELECT title, body_json FROM lesson_sections WHERE lesson_id=? ORDER BY level', lessonId);
  return secs
    .map((s) => {
      const b = parseJson<{ paragraphs?: { text: string }[]; concepts?: { term: string; definition: string }[]; positions?: { position: string; holders: string; arguments: string }[] }>(s.body_json, {});
      const parts = [
        ...(b.paragraphs ?? []).map((p) => p.text),
        ...(b.concepts ?? []).map((c) => `${c.term}: ${c.definition}`),
        ...(b.positions ?? []).map((p) => `${p.position} (${p.holders}): ${p.arguments}`),
      ];
      return parts.length ? `${s.title}\n${parts.join('\n')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}
