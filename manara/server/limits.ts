import { q } from './db.ts';
import { HttpError, addDays, nowIso } from './util.ts';

/**
 * Subscription structure. Prices are intentionally NOT set: they must come from
 * a real cost study (tokens per lesson x model price). Limits are monthly.
 */
export type Metric = 'lessons' | 'tutor' | 'research' | 'plans';
export const PLANS: Record<string, { label: { ar: string; en: string }; journeys: number; limits: Record<Metric, number>; features: string[] }> = {
  trial: { label: { ar: 'تجربة مجانية (14 يومًا)', en: 'Free trial (14 days)' }, journeys: 1, limits: { lessons: 30, tutor: 60, research: 40, plans: 4 }, features: ['map', 'voice'] },
  basic: { label: { ar: 'أساسي', en: 'Basic' }, journeys: 2, limits: { lessons: 40, tutor: 150, research: 60, plans: 6 }, features: ['map', 'voice'] },
  pro: { label: { ar: 'احترافي', en: 'Pro' }, journeys: 5, limits: { lessons: 120, tutor: 600, research: 200, plans: 20 }, features: ['map', 'voice', 'updates'] },
  academic: { label: { ar: 'أكاديمي', en: 'Academic' }, journeys: 15, limits: { lessons: 400, tutor: 2000, research: 800, plans: 60 }, features: ['map', 'voice', 'updates', 'deep_research'] },
};

const period = () => new Date().toISOString().slice(0, 7);

export function ensureSubscription(userId: string) {
  const s = q.get('SELECT user_id FROM subscriptions WHERE user_id=?', userId);
  if (!s) q.run('INSERT INTO subscriptions(user_id,plan,status,started_at,ends_at) VALUES (?,?,?,?,?)', userId, 'trial', 'active', nowIso(), addDays(new Date(), 14).toISOString());
}

export function getSubscription(userId: string) {
  ensureSubscription(userId);
  const s = q.get<{ plan: string; status: string; started_at: string; ends_at: string | null }>('SELECT plan,status,started_at,ends_at FROM subscriptions WHERE user_id=?', userId)!;
  const expired = s.ends_at !== null && s.ends_at < nowIso();
  const plan = PLANS[s.plan] ?? PLANS.trial;
  const usage = Object.fromEntries(
    (['lessons', 'tutor', 'research', 'plans'] as Metric[]).map((m) => [
      m,
      q.get<{ count: number }>('SELECT count FROM usage WHERE user_id=? AND period=? AND metric=?', userId, period(), m)?.count ?? 0,
    ]),
  ) as Record<Metric, number>;
  return { ...s, expired, planInfo: plan, usage, period: period() };
}

/**
 * Check a limit before an AI action. When a trial expires we keep everything
 * already generated readable (no surprise lock-out): only new generation stops.
 */
export function checkLimit(userId: string, metric: Metric) {
  const s = getSubscription(userId);
  if (s.expired) throw new HttpError(402, 'subscription_expired');
  if (s.usage[metric] >= s.planInfo.limits[metric]) throw new HttpError(429, `limit_${metric}`);
}

export function recordUsage(userId: string, metric: Metric, n = 1) {
  q.run(
    `INSERT INTO usage(user_id,period,metric,count) VALUES (?,?,?,?)
     ON CONFLICT(user_id,period,metric) DO UPDATE SET count=count+excluded.count`,
    userId, period(), metric, n,
  );
}
