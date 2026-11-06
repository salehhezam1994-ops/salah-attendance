import { q } from '../db.ts';
import { nowIso, safeLog } from '../util.ts';
import { config } from '../config.ts';
import { getPrefs } from './prefs.ts';
import { sendToUser } from './push.ts';
import { todayLesson, ensureLessonReady } from './lessons.ts';
import { dueReviews, checkUpdates } from './companion.ts';
import { interviewOf, getJourney, type JourneyRow } from './journeys.ts';
import { aiMode } from '../ai/llm.ts';
import { getSubscription } from '../limits.ts';

/**
 * Notification scheduler. Rules that keep it gentle:
 *  - everything happens in the learner's local time zone, never inside quiet hours;
 *  - at most ONE reminder a day (today's dose, or — if the dose is done — due reviews);
 *  - after 3+ days away: no daily nagging, only a single "welcome back" on day 3 and day 7, then silence;
 *  - research updates only when the learner opted in, and only for genuinely new items.
 */
export function localParts(now: Date, tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
export function inQuiet(min: number, start: string, end: string) {
  const a = hm(start);
  const b = hm(end);
  if (a === b) return false;
  return a < b ? min >= a && min < b : min >= a || min < b;
}

const logged = (userId: string, kind: string, day: string) => !!q.get('SELECT 1 FROM push_log WHERE user_id=? AND kind=? AND day=?', userId, kind, day);
const log = (userId: string, kind: string, day: string) => q.run('INSERT OR IGNORE INTO push_log(user_id,kind,day,sent_at) VALUES (?,?,?,?)', userId, kind, day, nowIso());

type Text = { ar: string; en: string };
const pick = (lang: string, t: Text) => (lang === 'ar' ? t.ar : t.en);

async function tickUser(userId: string, now: Date) {
  const prefs = getPrefs(userId);
  if (!prefs.notify.enabled) return;
  const { date, minutes } = localParts(now, prefs.timezone);
  const quiet = inQuiet(minutes, prefs.notify.quietStart, prefs.notify.quietEnd);
  const journeys = q.all<JourneyRow>("SELECT * FROM journeys WHERE user_id=? AND status='active' ORDER BY last_active_at DESC", userId);
  if (!journeys.length) return;
  const j = journeys[0];
  const lang = interviewOf(j).lang ?? prefs.locale;
  const daily = hm(prefs.notify.dailyTime);

  // Prepare today's dose ~45 min ahead so it is ready when the reminder arrives.
  if (minutes >= daily - 45) {
    const today = todayLesson(j.id);
    if (today?.status === 'planned') await ensureLessonReady(userId, today.id).catch(() => undefined);
  }

  // Weekly research-updates watch (opt-in, plan feature).
  for (const jr of journeys) {
    if (aiMode() !== 'anthropic' || !interviewOf(jr).slots.follow_updates) continue;
    if (!getSubscription(userId).planInfo.features.includes('updates')) continue;
    const last = jr.updates_checked_at ? Date.parse(jr.updates_checked_at) : 0;
    if (now.getTime() - last < 7 * 86400000) continue;
    q.run('UPDATE journeys SET updates_checked_at=? WHERE id=?', nowIso(), jr.id);
    await checkUpdates(userId, jr.id).catch((e) => safeLog('auto updates', e));
  }

  if (quiet || minutes < daily || logged(userId, 'daily', date)) return;

  const lastActive = Math.max(...journeys.map((x) => Date.parse(x.last_active_at ?? x.created_at)));
  const daysAway = Math.floor((now.getTime() - lastActive) / 86400000);
  if (daysAway >= 3) {
    log(userId, 'daily', date);
    if (!prefs.notify.comeback || (daysAway !== 3 && daysAway !== 7) || logged(userId, 'comeback', `d${daysAway}:${j.last_active_at}`)) return;
    log(userId, 'comeback', `d${daysAway}:${j.last_active_at}`);
    const where = q.get<{ title: string }>("SELECT n.title FROM lessons l JOIN nodes n ON n.id=l.node_id WHERE l.journey_id=? AND l.status='read' ORDER BY l.read_at DESC LIMIT 1", j.id)?.title;
    await sendToUser(userId, {
      title: pick(lang, { ar: 'مرحبًا بعودتك', en: 'Welcome back' }),
      body: where
        ? pick(lang, { ar: `توقفنا عند «${where}». حين تكون مستعدًا، نتابع بخطوة قصيرة.`, en: `We stopped at "${where}". Whenever you're ready, a short step awaits.` })
        : pick(lang, { ar: 'رحلتك المعرفية بانتظارك، بخطوة قصيرة متى شئت.', en: 'Your journey is waiting — one short step whenever you like.' }),
      url: `/j/${j.id}`,
      tag: `comeback:${j.id}`,
    }, j.id);
    return;
  }

  const today = todayLesson(j.id);
  const readRecently = !!q.get("SELECT 1 FROM lessons WHERE journey_id=? AND status='read' AND read_at>?", j.id, new Date(now.getTime() - 16 * 3600000).toISOString());
  const reviews = prefs.notify.reviews ? dueReviews(userId, j.id).items.length : 0;
  if (today && !readRecently && ['ready', 'planned', 'generating'].includes(today.status)) {
    log(userId, 'daily', date);
    const extra = reviews ? pick(lang, { ar: ` ومعها ${reviews} أسئلة مراجعة قصيرة.`, en: ` Plus ${reviews} short review questions.` }) : '';
    await sendToUser(userId, {
      title: pick(lang, { ar: 'جرعتك المعرفية اليوم', en: "Today's knowledge dose" }),
      body: `${today.title}${today.minutes ? pick(lang, { ar: ` (نحو ${today.minutes} د)`, en: ` (~${today.minutes} min)` }) : ''}.${extra}`,
      url: `/j/${j.id}/lesson/${today.id}`,
      tag: `daily:${j.id}`,
    }, j.id);
  } else if (reviews > 0) {
    log(userId, 'daily', date);
    await sendToUser(userId, {
      title: pick(lang, { ar: 'مراجعة قصيرة', en: 'A short review' }),
      body: pick(lang, { ar: `${reviews} أسئلة لتثبيت ما تعلمته، تستغرق دقيقة أو دقيقتين.`, en: `${reviews} questions to lock in what you learned — a minute or two.` }),
      url: `/j/${j.id}/review`,
      tag: `review:${j.id}`,
    }, j.id);
  }
}

/** Called by the updates agent when new items were found. */
export async function notifyUpdates(userId: string, journeyId: string, added: number, now = new Date()) {
  const prefs = getPrefs(userId);
  if (!added || !prefs.notify.enabled || !prefs.notify.updates) return;
  const { date, minutes } = localParts(now, prefs.timezone);
  if (inQuiet(minutes, prefs.notify.quietStart, prefs.notify.quietEnd) || logged(userId, 'update', date)) return;
  log(userId, 'update', date);
  const lang = interviewOf(getJourney(userId, journeyId)).lang;
  await sendToUser(userId, {
    title: pick(lang, { ar: 'مستجدات علمية في مجالك', en: 'New research in your field' }),
    body: pick(lang, { ar: `وجدت ${added} مستجدات؛ لن يُضاف شيء إلى خطتك دون موافقتك.`, en: `${added} new items found — nothing is added to your plan without your consent.` }),
    url: `/j/${journeyId}/plan#updates`,
    tag: `update:${journeyId}`,
  }, journeyId);
}

export async function runNotifierTick(now = new Date()) {
  const users = q.all<{ user_id: string }>('SELECT DISTINCT user_id FROM push_subscriptions');
  for (const u of users) {
    try {
      await tickUser(u.user_id, now);
    } catch (e) {
      safeLog('notifier', e);
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let busy = false;
export function startNotifier() {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runNotifierTick();
    } finally {
      busy = false;
    }
  }, config.schedulerIntervalMs);
  timer.unref();
}
