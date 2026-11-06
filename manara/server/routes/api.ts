import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { q } from '../db.ts';
import { HttpError, newId, nowIso, parseJson } from '../util.ts';
import { createSession, createUser, destroySession, hashPassword, isAdmin, requireUser, verifyPassword, type AppEnv } from '../auth.ts';
import { getPrefs, savePrefs, PrefsSchema } from '../services/prefs.ts';
import { getSubscription, PLANS } from '../limits.ts';
import { aiMode } from '../ai/llm.ts';
import {
  acceptGoal, approvePlan, confirmChange, conversationId, createJourney, getJourney, interviewAnswer, interviewBack, interviewHelp,
  interviewOf, layoutLessons, messagesOf, requestChange, reviseGoal, updateSettings, type PlanMeta,
} from '../services/journeys.ts';
import { ensureLessonReady, getLesson, lessonPayload, markRead, openLevel, todayLesson } from '../services/lessons.ts';
import {
  addUpdateToPlan, answerReview, checkUpdates, companionMessage, deleteUser, dueReviews, exportUserData, journeyProgress, journeySynthesis,
  lessonQuiz, library, searchKnowledge,
} from '../services/companion.ts';
import type { Goal } from '../ai/planner.ts';

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    /* empty body */
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, 'invalid_input', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

const api = new Hono<AppEnv>();

api.get('/health', (c) => c.json({ ok: true, ai: aiMode() }));

/* ------------------------------ Auth ------------------------------ */
const Email = z.string().trim().toLowerCase().email().max(200);
const Password = z.string().min(8).max(200);

api.post('/auth/guest', async (c) => {
  const { locale } = await body(c, z.object({ locale: z.enum(['ar', 'en']).default('ar') }));
  const id = createUser({});
  savePrefs(id, { locale });
  createSession(c, id);
  return c.json({ ok: true });
});

api.post('/auth/register', async (c) => {
  const b = await body(c, z.object({ email: Email, password: Password, name: z.string().trim().max(100).optional(), locale: z.enum(['ar', 'en']).optional() }));
  if (q.get('SELECT id FROM users WHERE email=?', b.email)) throw new HttpError(409, 'email_taken');
  // If a guest is signed in, upgrade that account so nothing is lost.
  let guestId: string | null = null;
  try {
    await requireUser(c as Context<AppEnv>, async () => undefined);
    const u = (c as Context<AppEnv>).get('user');
    if (u.is_guest) guestId = u.id;
  } catch {
    /* no session */
  }
  let id = guestId;
  if (id) q.run('UPDATE users SET email=?, name=?, password_hash=?, is_guest=0 WHERE id=?', b.email, b.name ?? null, hashPassword(b.password), id);
  else {
    id = createUser({ email: b.email, name: b.name, password: b.password });
    if (b.locale) savePrefs(id, { locale: b.locale });
  }
  createSession(c, id);
  return c.json({ ok: true });
});

api.post('/auth/login', async (c) => {
  const b = await body(c, z.object({ email: Email, password: z.string().max(200) }));
  const u = q.get<{ id: string; password_hash: string | null }>('SELECT id,password_hash FROM users WHERE email=?', b.email);
  if (!u || !verifyPassword(b.password, u.password_hash)) throw new HttpError(401, 'bad_credentials');
  createSession(c, u.id);
  return c.json({ ok: true });
});

api.post('/auth/logout', (c) => {
  destroySession(c);
  return c.json({ ok: true });
});

/* Everything below requires a session. */
const auth = new Hono<AppEnv>();
auth.use('*', requireUser);

auth.get('/me', (c) => {
  const u = c.get('user');
  const journeys = q.all<{ id: string; title: string | null; topic: string; status: string; last_active_at: string | null }>(
    "SELECT id,title,topic,status,last_active_at FROM journeys WHERE user_id=? AND status<>'archived' ORDER BY last_active_at DESC", u.id,
  ).map((j) => ({ ...j, progress: ['active', 'paused'].includes(j.status) ? journeyProgress(j.id).percent : null }));
  const sub = getSubscription(u.id);
  return c.json({ user: { ...u, admin: isAdmin(u) }, prefs: getPrefs(u.id), subscription: sub, plans: PLANS, ai: aiMode(), journeys });
});

auth.put('/prefs', async (c) => {
  const patch = await body(c, PrefsSchema.partial());
  return c.json(savePrefs(c.get('user').id, patch));
});

auth.get('/me/export', (c) => {
  const data = exportUserData(c.get('user').id);
  c.header('Content-Disposition', 'attachment; filename="manara-export.json"');
  return c.json(data);
});

auth.delete('/me', (c) => {
  const id = c.get('user').id;
  destroySession(c);
  deleteUser(id);
  return c.json({ ok: true });
});

/* ------------------------------ Journeys ------------------------------ */
auth.post('/journeys', async (c) => {
  const b = await body(c, z.object({ lang: z.enum(['ar', 'en']).optional() }));
  const u = c.get('user');
  return c.json(createJourney(u.id, b.lang ?? getPrefs(u.id).locale));
});

auth.get('/journeys/:id', (c) => {
  const u = c.get('user');
  const j = getJourney(u.id, c.req.param('id'));
  const st = interviewOf(j);
  const conv = conversationId(u.id, j.id, 'interview');
  const plan = parseJson<PlanMeta | null>(j.plan_json, null);
  const stages = q.all<{ id: string; idx: number; title: string; description: string; weeks: number }>('SELECT id,idx,title,description,weeks FROM stages WHERE journey_id=? ORDER BY idx', j.id).map((s) => ({
    ...s,
    topics: q.all<{ id: string; title: string; kind: string; status: string }>("SELECT id,title,kind,status FROM nodes WHERE stage_id=? AND kind IN ('trunk','branch','root') ORDER BY order_idx LIMIT 12", s.id),
    lessons: q.get<{ n: number }>('SELECT COUNT(*) n FROM lessons l JOIN nodes n ON n.id=l.node_id WHERE n.stage_id=?', s.id)!.n,
  }));
  const keySources = q.all('SELECT id,title,authors,year,kind,url,is_primary,verification_status FROM sources WHERE journey_id=? ORDER BY is_primary DESC, verification_status=\'verified\' DESC LIMIT 8', j.id);
  return c.json({
    journey: { id: j.id, title: j.title, topic: j.topic, status: j.status, map_model: j.map_model, ai_mode: j.ai_mode, created_at: j.created_at, started_at: j.started_at, last_active_at: j.last_active_at },
    lang: st.lang,
    slots: st.slots,
    interview: ['interviewing', 'confirming'].includes(j.status) ? { messages: messagesOf(conv), current: st.current, question: st.currentQuestion, step: st.history.length + 1 } : null,
    goal: parseJson<Goal | null>(j.goal_json, null),
    plan,
    stages,
    keySources,
    pendingChange: parseJson(j.pending_change_json, null),
  });
});

auth.post('/journeys/:id/interview/answer', async (c) => {
  const b = await body(c, z.object({ text: z.string().max(2000).default(''), choice: z.string().max(100).optional() }));
  return c.json(await interviewAnswer(c.get('user').id, c.req.param('id'), b.text, b.choice));
});
auth.post('/journeys/:id/interview/back', (c) => c.json(interviewBack(c.get('user').id, c.req.param('id'))));
auth.post('/journeys/:id/interview/help', (c) => c.json(interviewHelp(c.get('user').id, c.req.param('id'))));

auth.post('/journeys/:id/goal', async (c) => {
  const b = await body(c, z.object({ accept: z.boolean(), correction: z.string().max(2000).optional() }));
  const u = c.get('user');
  if (b.accept) return c.json(acceptGoal(u.id, c.req.param('id')));
  if (!b.correction?.trim()) throw new HttpError(400, 'correction_required');
  return c.json(await reviseGoal(u.id, c.req.param('id'), b.correction.trim()));
});

auth.post('/journeys/:id/approve', (c) => c.json(approvePlan(c.get('user').id, c.req.param('id'))));

auth.post('/journeys/:id/change', async (c) => {
  const b = await body(c, z.object({ request: z.string().trim().min(2).max(1000) }));
  return c.json(await requestChange(c.get('user').id, c.req.param('id'), b.request));
});
auth.post('/journeys/:id/change/confirm', async (c) => {
  const b = await body(c, z.object({ accept: z.boolean() }));
  return c.json(await confirmChange(c.get('user').id, c.req.param('id'), b.accept));
});

auth.patch('/journeys/:id/settings', async (c) => {
  const b = await body(c, z.object({
    minutes_per_day: z.number().int().min(3).max(120).optional(),
    duration_weeks: z.number().int().min(1).max(156).optional(),
    detail: z.enum(['brief', 'medium', 'detailed']).optional(),
    depth: z.enum(['general', 'deep', 'research']).optional(),
    source_pref: z.enum(['classic', 'modern', 'both']).optional(),
  }));
  return c.json(await updateSettings(c.get('user').id, c.req.param('id'), b));
});

auth.post('/journeys/:id/status', async (c) => {
  const b = await body(c, z.object({ status: z.enum(['active', 'paused', 'archived']) }));
  const j = getJourney(c.get('user').id, c.req.param('id'));
  if (!['active', 'paused', 'archived'].includes(j.status) && b.status !== 'archived') throw new HttpError(409, 'bad_state');
  q.run('UPDATE journeys SET status=?, last_active_at=? WHERE id=?', b.status, nowIso(), j.id);
  return c.json({ ok: true });
});

/** Home: today's dose + context; also creates gentle reminders. */
auth.get('/journeys/:id/home', (c) => {
  const u = c.get('user');
  const j = getJourney(u.id, c.req.param('id'));
  const today = todayLesson(j.id);
  if (today && today.status === 'planned' && j.status === 'active') void ensureLessonReady(u.id, today.id).catch(() => undefined);
  const daysAway = j.last_active_at ? Math.floor((Date.now() - Date.parse(j.last_active_at)) / 86400000) : 0;
  const lastRead = q.get<{ title: string; node: string }>("SELECT l.title, n.title node FROM lessons l JOIN nodes n ON n.id=l.node_id WHERE l.journey_id=? AND l.status='read' ORDER BY l.read_at DESC LIMIT 1", j.id);
  const recent = q.all("SELECT id,title,read_at FROM lessons WHERE journey_id=? AND status='read' ORDER BY read_at DESC LIMIT 4", j.id);
  const due = dueReviews(u.id, j.id);
  const updates = q.get<{ n: number }>("SELECT COUNT(*) n FROM updates WHERE journey_id=? AND status='new'", j.id)!.n;
  if (j.status === 'active') q.run('UPDATE journeys SET last_active_at=? WHERE id=?', nowIso(), j.id);
  return c.json({
    today: today ? { ...today, ...(today.status === 'planned' ? { status: 'generating' } : {}) } : null,
    progress: journeyProgress(j.id),
    welcomeBack: daysAway >= 3 ? { days: daysAway, lastTopic: lastRead?.node ?? null } : null,
    recent,
    reviewsDue: due.items.length,
    nextReview: due.nextDue,
    updates,
    status: j.status,
  });
});

auth.get('/journeys/:id/map', (c) => {
  const j = getJourney(c.get('user').id, c.req.param('id'));
  const nodes = q.all<Record<string, unknown> & { id: string }>(
    `SELECT n.id,n.parent_id,n.stage_id,n.kind,n.title,n.summary,n.status,n.mastery,n.order_idx,n.pos_x,n.pos_y,
      (SELECT COUNT(*) FROM lessons l WHERE l.node_id=n.id) lessons,
      (SELECT COUNT(*) FROM lessons l WHERE l.node_id=n.id AND l.status='read') read,
      (SELECT id FROM lessons l WHERE l.node_id=n.id ORDER BY CASE WHEN l.status='read' THEN 1 ELSE 0 END, l.seq LIMIT 1) next_lesson
     FROM nodes n WHERE n.journey_id=? ORDER BY n.order_idx`,
    j.id,
  ).map((n) => ({ ...n, sources: q.all('SELECT s.id,s.title,s.url,s.kind,s.verification_status FROM sources s JOIN node_sources ns ON ns.source_id=s.id WHERE ns.node_id=? LIMIT 6', n.id) }));
  const relations = q.all('SELECT id,from_node,to_node,type,note FROM relations WHERE journey_id=?', j.id);
  const stages = q.all('SELECT id,idx,title FROM stages WHERE journey_id=? ORDER BY idx', j.id);
  return c.json({ model: j.map_model, title: j.title, nodes, relations, stages });
});

auth.put('/journeys/:id/map/nodes/:nodeId', async (c) => {
  const b = await body(c, z.object({ pos_x: z.number().nullable(), pos_y: z.number().nullable() }));
  const j = getJourney(c.get('user').id, c.req.param('id'));
  q.run('UPDATE nodes SET pos_x=?, pos_y=? WHERE id=? AND journey_id=?', b.pos_x, b.pos_y, c.req.param('nodeId'), j.id);
  return c.json({ ok: true });
});

/** Advanced management mode: direct control for specialists. */
auth.get('/journeys/:id/advanced', (c) => {
  const j = getJourney(c.get('user').id, c.req.param('id'));
  const st = interviewOf(j);
  return c.json({
    slots: st.slots,
    stages: q.all('SELECT id,idx,title,description,weeks FROM stages WHERE journey_id=? ORDER BY idx', j.id),
    nodes: q.all(
      `SELECT n.id,n.stage_id,n.parent_id,n.kind,n.title,n.status,n.lesson_order weight,n.order_idx,
        (SELECT COUNT(*) FROM lessons l WHERE l.node_id=n.id) lessons, (SELECT COUNT(*) FROM lessons l WHERE l.node_id=n.id AND l.status='read') read
       FROM nodes n WHERE n.journey_id=? ORDER BY n.order_idx`, j.id,
    ),
    sources: q.all('SELECT id,title,authors,year,kind,url,verification_status,is_primary FROM sources WHERE journey_id=? ORDER BY title', j.id),
  });
});

auth.patch('/journeys/:id/nodes/:nodeId', async (c) => {
  const b = await body(c, z.object({
    title: z.string().trim().min(1).max(200).optional(),
    weight: z.number().int().min(1).max(5).optional(),
    skip: z.boolean().optional(),
    move: z.enum(['up', 'down']).optional(),
    stage_id: z.string().optional(),
  }));
  const u = c.get('user');
  const j = getJourney(u.id, c.req.param('id'));
  const n = q.get<{ id: string; order_idx: number; stage_id: string | null; status: string }>('SELECT id,order_idx,stage_id,status FROM nodes WHERE id=? AND journey_id=?', c.req.param('nodeId'), j.id);
  if (!n) throw new HttpError(404, 'node_not_found');
  q.tx(() => {
    if (b.title) q.run('UPDATE nodes SET title=? WHERE id=?', b.title, n.id);
    if (b.weight) q.run('UPDATE nodes SET lesson_order=? WHERE id=?', b.weight, n.id);
    if (b.skip !== undefined && n.status !== 'done') q.run('UPDATE nodes SET status=? WHERE id=?', b.skip ? 'skipped' : 'upcoming', n.id);
    if (b.stage_id && q.get('SELECT id FROM stages WHERE id=? AND journey_id=?', b.stage_id, j.id)) q.run('UPDATE nodes SET stage_id=? WHERE id=?', b.stage_id, n.id);
    if (b.move) {
      const other = q.get<{ id: string; order_idx: number }>(
        `SELECT id,order_idx FROM nodes WHERE journey_id=? AND stage_id IS ? AND order_idx ${b.move === 'up' ? '<' : '>'} ? ORDER BY order_idx ${b.move === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
        j.id, n.stage_id, n.order_idx,
      );
      if (other) {
        q.run('UPDATE nodes SET order_idx=? WHERE id=?', other.order_idx, n.id);
        q.run('UPDATE nodes SET order_idx=? WHERE id=?', n.order_idx, other.id);
      }
    }
    if (b.weight || b.skip !== undefined || b.move || b.stage_id) layoutLessons(j.id, interviewOf(j).slots);
  });
  return c.json({ ok: true });
});

auth.get('/journeys/:id/progress', (c) => {
  const j = getJourney(c.get('user').id, c.req.param('id'));
  return c.json(journeyProgress(j.id));
});
auth.post('/journeys/:id/synthesis', async (c) => c.json(await journeySynthesis(c.get('user').id, c.req.param('id'))));
auth.get('/journeys/:id/library', (c) => c.json(library(c.get('user').id, c.req.param('id'))));
auth.get('/journeys/:id/reviews/due', (c) => c.json(dueReviews(c.get('user').id, c.req.param('id'))));

auth.get('/journeys/:id/companion', (c) => {
  const u = c.get('user');
  const j = getJourney(u.id, c.req.param('id'));
  return c.json({ messages: messagesOf(conversationId(u.id, j.id, 'tutor')).slice(-60) });
});
auth.post('/journeys/:id/companion', async (c) => {
  const b = await body(c, z.object({ text: z.string().trim().min(1).max(4000), lessonId: z.string().nullable().optional(), context: z.string().max(12000).optional() }));
  return c.json(await companionMessage(c.get('user').id, c.req.param('id'), b.text, b.lessonId ?? null, b.context));
});

auth.get('/journeys/:id/updates', (c) => {
  const j = getJourney(c.get('user').id, c.req.param('id'));
  return c.json({ items: q.all("SELECT * FROM updates WHERE journey_id=? AND status<>'dismissed' ORDER BY found_at DESC", j.id), following: !!interviewOf(j).slots.follow_updates });
});
auth.post('/journeys/:id/updates/check', async (c) => c.json(await checkUpdates(c.get('user').id, c.req.param('id'))));
auth.post('/updates/:id/add', async (c) => c.json(await addUpdateToPlan(c.get('user').id, c.req.param('id'))));
auth.post('/updates/:id/dismiss', (c) => {
  q.run("UPDATE updates SET status='dismissed' WHERE id=? AND journey_id IN (SELECT id FROM journeys WHERE user_id=?)", c.req.param('id'), c.get('user').id);
  return c.json({ ok: true });
});

/* ------------------------------ Lessons ------------------------------ */
auth.get('/lessons/:id', async (c) => {
  const u = c.get('user');
  const l = getLesson(u.id, c.req.param('id'));
  if (l.status === 'planned') await ensureLessonReady(u.id, l.id).catch(() => undefined);
  return c.json(lessonPayload(u.id, l.id));
});
auth.post('/lessons/:id/generate', async (c) => {
  const u = c.get('user');
  await ensureLessonReady(u.id, c.req.param('id'));
  return c.json({ ok: true });
});
auth.post('/lessons/:id/level', async (c) => {
  const b = await body(c, z.object({ level: z.number().int().min(1).max(5) }));
  openLevel(c.get('user').id, c.req.param('id'), b.level);
  return c.json({ ok: true });
});
auth.post('/lessons/:id/read', async (c) => {
  const b = await body(c, z.object({ seconds: z.number().min(0).default(0) }));
  return c.json(markRead(c.get('user').id, c.req.param('id'), b.seconds));
});
auth.post('/lessons/:id/save', async (c) => {
  const b = await body(c, z.object({ saved: z.boolean() }));
  const l = getLesson(c.get('user').id, c.req.param('id'));
  q.run('UPDATE lessons SET saved=? WHERE id=?', b.saved ? 1 : 0, l.id);
  return c.json({ ok: true });
});
auth.post('/lessons/:id/listen', async (c) => {
  const b = await body(c, z.object({ seconds: z.number().min(0).max(7200) }));
  const u = c.get('user');
  const l = getLesson(u.id, c.req.param('id'));
  q.run('INSERT INTO progress_events(id,user_id,journey_id,lesson_id,kind,seconds,created_at) VALUES (?,?,?,?,?,?,?)', newId('pe_'), u.id, l.journey_id, l.id, 'listen', Math.round(b.seconds), nowIso());
  return c.json({ ok: true });
});
auth.get('/lessons/:id/quiz', (c) => c.json({ items: lessonQuiz(c.get('user').id, c.req.param('id')) }));

auth.post('/reviews/:itemId', async (c) => {
  const b = await body(c, z.object({ result: z.enum(['remembered', 'partial', 'forgot']), answer: z.string().max(2000).nullable().optional(), sessionId: z.string().nullable().optional() }));
  return c.json(answerReview(c.get('user').id, c.req.param('itemId'), b.result, b.answer ?? null, b.sessionId ?? null));
});

/* ------------------------------ Notes & search ------------------------------ */
auth.post('/notes', async (c) => {
  const b = await body(c, z.object({ journeyId: z.string(), lessonId: z.string().nullable().optional(), body: z.string().trim().min(1).max(8000) }));
  const u = c.get('user');
  getJourney(u.id, b.journeyId);
  if (b.lessonId) getLesson(u.id, b.lessonId);
  const id = newId('nt_');
  q.run('INSERT INTO notes(id,user_id,journey_id,lesson_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', id, u.id, b.journeyId, b.lessonId ?? null, b.body, nowIso(), nowIso());
  return c.json({ id });
});
auth.put('/notes/:id', async (c) => {
  const b = await body(c, z.object({ body: z.string().trim().min(1).max(8000) }));
  const r = q.run('UPDATE notes SET body=?, updated_at=? WHERE id=? AND user_id=?', b.body, nowIso(), c.req.param('id'), c.get('user').id);
  if (!r.changes) throw new HttpError(404, 'note_not_found');
  return c.json({ ok: true });
});
auth.delete('/notes/:id', (c) => {
  q.run('DELETE FROM notes WHERE id=? AND user_id=?', c.req.param('id'), c.get('user').id);
  return c.json({ ok: true });
});
auth.get('/search', (c) => {
  const term = (c.req.query('q') ?? '').trim();
  if (term.length < 2) return c.json({ lessons: [], concepts: [], notes: [], sources: [] });
  return c.json(searchKnowledge(c.get('user').id, c.req.query('journeyId') || null, term.slice(0, 100)));
});

/* ------------------------------ Notifications ------------------------------ */
auth.get('/notifications', (c) => c.json({ items: q.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30', c.get('user').id) }));
auth.post('/notifications/:id/read', (c) => {
  q.run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', nowIso(), c.req.param('id'), c.get('user').id);
  return c.json({ ok: true });
});

/* ------------------------------ Admin ------------------------------ */
auth.get('/admin/stats', (c) => {
  if (!isAdmin(c.get('user'))) throw new HttpError(403, 'forbidden');
  const count = (sql: string) => q.get<{ n: number }>(sql)!.n;
  return c.json({
    users: count('SELECT COUNT(*) n FROM users'),
    journeys: count('SELECT COUNT(*) n FROM journeys'),
    activeJourneys: count("SELECT COUNT(*) n FROM journeys WHERE status='active'"),
    lessonsGenerated: count("SELECT COUNT(*) n FROM lessons WHERE status IN ('ready','read')"),
    lessonsFailed: count("SELECT COUNT(*) n FROM lessons WHERE status='failed'"),
    sources: q.all('SELECT verification_status, COUNT(*) n FROM sources GROUP BY verification_status'),
    usage: q.all('SELECT period, metric, SUM(count) n FROM usage GROUP BY period, metric ORDER BY period DESC LIMIT 24'),
    errors: q.all('SELECT at, context, message FROM error_log ORDER BY id DESC LIMIT 30'),
    ai: aiMode(),
  });
});

api.route('/', auth);
export default api;
