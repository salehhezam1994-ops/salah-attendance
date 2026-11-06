/**
 * Review Agent — scheduling side. Questions come from the Synthesis Agent
 * (grounded in the same excerpts); this module schedules them with a light
 * SM-2 variant so reviews stay short and proportional to the learner's time.
 */
export type ReviewResult = 'remembered' | 'partial' | 'forgot';

export function schedule(item: { ease: number; interval_days: number; reps: number; lapses: number }, result: ReviewResult, now = new Date()) {
  let { ease, interval_days, reps, lapses } = item;
  if (result === 'forgot') {
    lapses += 1;
    reps = 0;
    interval_days = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    const q = result === 'remembered' ? 5 : 3;
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    if (reps === 1) interval_days = result === 'remembered' ? 2 : 1;
    else if (reps === 2) interval_days = result === 'remembered' ? 6 : 3;
    else interval_days = Math.round(interval_days * (result === 'remembered' ? ease : 1.2));
  }
  interval_days = Math.min(interval_days, 180);
  const due = new Date(now.getTime() + interval_days * 86400000);
  return { ease, interval_days, reps, lapses, due_at: due.toISOString() };
}

/** How many review cards fit the learner's daily time (≈ 30s per card, ≤ 25% of the dose). */
export function dailyReviewBudget(minutesPerDay: number) {
  return Math.max(2, Math.min(12, Math.round((minutesPerDay * 60 * 0.25) / 30)));
}
