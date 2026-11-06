import { z } from 'zod';
import type { LLM } from './llm.ts';
import type { Slots, Lang } from './interview.ts';

/** ---------------- Goal Analysis Agent ---------------- */
export const GoalSchema = z.object({
  statement: z.string(), // "I understood that you want ..." — shown for confirmation
  title: z.string(), // short journey title
  scope_in: z.array(z.string()),
  scope_out: z.array(z.string()),
  prerequisites: z.array(z.string()),
  field_nature: z.enum(['long_tradition', 'modern', 'mixed']),
  map_model: z.enum(['tree', 'network']),
  start_level: z.enum(['foundations', 'intermediate', 'advanced']),
});
export type Goal = z.infer<typeof GoalSchema>;

const GOAL_SYSTEM = `You are the Goal Analysis Agent of "Manara", a scholarly learning companion.
Turn the learner's interview answers into a clear, organised learning goal.
- statement: 2-3 sentences addressed to the learner, starting with "فهمت أنك تريد" (Arabic) or "I understand you want" (English), describing the progression (e.g. concepts and roots -> schools and debates -> contemporary questions) and the emphasis on sources they chose. End with a short question asking if this is what they mean.
- field_nature: long_tradition when the field has a long scholarly history with founding texts (e.g. kalam, law, philosophy, history); modern for recent fields (e.g. AI); mixed otherwise.
- map_model: "tree" when knowledge grows from roots to branches; "network" when concepts are densely interlinked without one root.
- Respect what the learner excluded. Do not invent constraints they did not express.
Write in the requested language.`;

export async function analyzeGoal(ai: LLM, lang: Lang, slots: Slots, correction?: string, previous?: Goal): Promise<Goal> {
  const prompt = JSON.stringify({ language: lang === 'ar' ? 'Arabic' : 'English', interview: slots, previous_understanding: previous ?? null, learner_correction: correction ?? null });
  return ai.json({ task: 'goal', tier: 'strong', system: GOAL_SYSTEM, prompt, schema: GoalSchema, effort: 'medium' });
}

/** ---------------- Curriculum Planner ---------------- */
export const PlanSchema = z.object({
  title: z.string(),
  overview: z.string(), // plain-language description of what will happen
  stages: z.array(z.object({ title: z.string(), description: z.string(), weeks: z.number() })),
  nodes: z.array(
    z.object({
      key: z.string(),
      parent_key: z.string().nullable(),
      stage_index: z.number(),
      kind: z.enum(['root', 'trunk', 'branch', 'leaf']),
      title: z.string(),
      summary: z.string(),
      teach: z.boolean(), // has daily lessons
      weight: z.number(), // 1..5 relative depth → number of lessons
      search_queries: z.array(z.string()),
      source_ids: z.array(z.string()), // S-ids from the research list only
    }),
  ),
  relations: z.array(z.object({ from: z.string(), to: z.string(), type: z.enum(['prerequisite', 'historical', 'conceptual', 'influence', 'disagreement', 'application']), note: z.string() })),
  review_policy: z.string(),
  updates_policy: z.string().nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

const PLAN_SYSTEM = `You are the Curriculum Planner of "Manara". Build a rigorous, well-ordered learning journey.
Principles:
- Base the structure on the research notes and the field's real scholarly organisation, not on wording alone.
- Order by prerequisites. For long-tradition fields start from roots and founding sources, then the development of the field, then contemporary questions. For modern fields start from core principles, then methods, then applications and current research. Do not force one historical order on every field.
- Knowledge map: roots = foundational concepts and historical/intellectual roots; trunk = major principles/axes; branches = schools, sub-fields, themes; leaves = specific questions, recent studies. Every non-root node has a parent_key.
- 3-6 stages; 18-45 nodes in total; mark teach=true on the nodes that get daily lessons (most branches and leaves, some trunk nodes). weight 1-5 = how much study it deserves.
- relations: typed links beyond the tree (prerequisite, historical, conceptual, influence, disagreement, application) with a one-line note. Only relations you can justify from the notes.
- search_queries: 2-3 precise queries (one in the learner's language, one in English or the field's scholarly language) the Research Agent will use for this node.
- source_ids: attach only S-ids from the provided source list; never invent sources.
- Respect exclusions and focus. Fit the learner's daily minutes and duration.
- overview: 2-4 plain sentences to the learner explaining what the journey will be like (duration, daily minutes, progression, sources, that they can ask for more any time).
Write titles and text in the requested language.`;

export async function buildPlan(
  ai: LLM,
  o: { lang: Lang; slots: Slots; goal: Goal; notes: string; sources: { sid: string; title: string; kind: string; year?: string; authors?: string }[]; changeRequest?: string; currentPlan?: unknown },
): Promise<Plan> {
  const prompt = JSON.stringify({
    language: o.lang === 'ar' ? 'Arabic' : 'English',
    learner: o.slots,
    goal: o.goal,
    research_notes: o.notes.slice(0, 12000),
    sources: o.sources,
    ...(o.changeRequest ? { current_plan: o.currentPlan, change_request: o.changeRequest, instruction: 'Revise the current plan to satisfy the change request. Keep node keys of unchanged nodes identical. Never remove nodes marked done.' } : {}),
  });
  return ai.json({ task: 'plan', tier: 'strong', system: PLAN_SYSTEM, prompt, schema: PlanSchema, effort: 'high' });
}

/** ---------------- Plan Edit understanding ---------------- */
export const ChangeSchema = z.object({
  summary: z.string(), // what will change, in the learner's language
  major: z.boolean(), // restructures topics/stages → needs explicit confirmation
  settings: z.object({
    minutes_per_day: z.number().nullable(),
    duration_weeks: z.number().nullable(),
    detail: z.enum(['brief', 'medium', 'detailed']).nullable(),
    depth: z.enum(['general', 'deep', 'research']).nullable(),
    source_pref: z.enum(['classic', 'modern', 'both']).nullable(),
  }),
  restructure: z.boolean(), // requires re-planning topics
  restructure_request: z.string().nullable(),
});
export type Change = z.infer<typeof ChangeSchema>;

export async function understandChange(ai: LLM, lang: Lang, request: string, slots: Slots, planTitle: string): Promise<Change> {
  return ai.json({
    task: 'plan_change',
    tier: 'fast',
    system: `You interpret a learner's natural-language request to change their learning plan in "Manara".
Map simple requests to settings (e.g. "make it 5 minutes a day" -> minutes_per_day=5; "faster" -> shorter duration_weeks; "more academic" -> depth=research; "more original books" -> source_pref=classic).
Set restructure=true when topics/stages must change (add an axis, drop a topic, focus on contemporary issues) and put a precise instruction in restructure_request.
major=true if the change restructures the plan or shortens/extends it by more than 30%. summary: one or two sentences in ${lang === 'ar' ? 'Arabic' : 'English'} describing exactly what will change.`,
    prompt: JSON.stringify({ request, current_settings: slots, plan: planTitle }),
    schema: ChangeSchema,
  });
}

/** Rule-based fallback for common simple requests (works without AI). */
export function ruleChange(request: string, slots: Slots, lang: Lang = 'ar'): Change | null {
  const ar = lang === 'ar';
  const r = request.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const settings: Change['settings'] = { minutes_per_day: null, duration_weeks: null, detail: null, depth: null, source_pref: null };
  const m = r.match(/(\d+)\s*(دق|min)/);
  if (m) settings.minutes_per_day = Number(m[1]);
  else if (/خمس دقائق/.test(r)) settings.minutes_per_day = 5;
  else if (/عشر دقائق/.test(r)) settings.minutes_per_day = 10;
  if (/أسرع|اسرع|faster|quicker/.test(r) && slots.duration_weeks) settings.duration_weeks = Math.max(2, Math.round(slots.duration_weeks * 0.75));
  if (/أبطأ|ابطأ|slower/.test(r) && slots.duration_weeks) settings.duration_weeks = Math.round(slots.duration_weeks * 1.25);
  if (/مختصر|brief|shorter/.test(r)) settings.detail = 'brief';
  if (/مفصل|detailed/.test(r)) settings.detail = 'detailed';
  if (/أكاديمي|اكاديمي|academic/.test(r)) settings.depth = 'research';
  if (/الكتب الأصلية|الأصلية|original/.test(r)) settings.source_pref = 'classic';
  if (/الحديثة|الدراسات الحديثة|recent/.test(r) && !/أضف|اضف|add/.test(r)) settings.source_pref = 'modern';
  if (Object.values(settings).every((v) => v === null)) return null;
  const parts: string[] = [];
  if (settings.minutes_per_day) parts.push(ar ? `الجرعة اليومية: ${settings.minutes_per_day} دقيقة` : `Daily dose: ${settings.minutes_per_day} min`);
  if (settings.duration_weeks) parts.push(ar ? `مدة الرحلة: ${settings.duration_weeks} أسبوعًا بدلًا من ${slots.duration_weeks}` : `Duration: ${settings.duration_weeks} weeks instead of ${slots.duration_weeks}`);
  if (settings.detail) parts.push(ar ? `مستوى التفصيل: ${settings.detail === 'brief' ? 'مختصر' : 'مفصل'}` : `Detail: ${settings.detail}`);
  if (settings.depth) parts.push(ar ? 'مستوى أكاديمي أعلى (يعاد بناء المحاور القادمة)' : 'Higher academic level (upcoming topics re-planned)');
  if (settings.source_pref) parts.push(settings.source_pref === 'classic' ? (ar ? 'مزيد من الكتب الأصلية' : 'More original works') : ar ? 'تركيز على الدراسات الحديثة' : 'Focus on recent studies');
  const ratio = settings.duration_weeks && slots.duration_weeks ? settings.duration_weeks / slots.duration_weeks : 1;
  return { summary: parts.join(ar ? '، ' : ', '), major: ratio < 0.7 || ratio > 1.3, settings, restructure: false, restructure_request: null };
}
