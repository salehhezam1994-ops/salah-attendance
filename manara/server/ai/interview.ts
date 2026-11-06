import { z } from 'zod';
import { llm, type LLM } from './llm.ts';
import { normalizeDigits, normalizeText } from '../util.ts';

/**
 * Interview Agent.
 * A deterministic slot-filling backbone (always works, even without AI) decides
 * WHAT is still unknown; the AI (when configured) understands free answers,
 * fills several slots at once, asks for clarification, and phrases the next
 * question naturally for the user's topic. One question at a time.
 */
export type Lang = 'ar' | 'en';
export type Slots = {
  topic?: string;
  motivation?: string;
  prior_knowledge?: string; // none | basic | intermediate | advanced | free text
  depth?: string; // general | deep | research
  outcome?: string;
  focus?: string; // focus areas and exclusions
  minutes_per_day?: number;
  duration_weeks?: number;
  detail?: string; // brief | medium | detailed
  source_pref?: string; // classic | modern | both
  follow_updates?: boolean;
  modality?: string; // read | listen | dialogue | mixed
};
export type SlotKey = keyof Slots;

export const SLOT_ORDER: SlotKey[] = [
  'topic', 'motivation', 'prior_knowledge', 'depth', 'outcome', 'focus',
  'minutes_per_day', 'duration_weeks', 'detail', 'source_pref', 'follow_updates', 'modality',
];

type Opt = { value: string; ar: string; en: string };
type QDef = { ar: string; en: string; helpAr: string; helpEn: string; options?: Opt[]; free: boolean; skippable?: boolean };

export const QUESTIONS: Record<SlotKey, QDef> = {
  topic: {
    ar: 'أهلًا بك في منارة المعرفة. ما الموضوع الذي تتمنى أن تصبح أكثر معرفة وتعمقًا فيه؟',
    en: 'Welcome to Manara. What subject would you love to know more deeply?',
    helpAr: 'اكتب أي مجال أو موضوع يشغلك، ولو بعبارة عامة، مثل: «الاقتصاد الإسلامي» أو «الذكاء الاصطناعي» أو «تاريخ الأندلس». سنحدده معًا بعد ذلك.',
    helpEn: 'Type any field or subject, even loosely, e.g. "behavioral economics", "AI", "history of al-Andalus". We will narrow it together.',
    free: true,
  },
  motivation: {
    ar: 'جميل. لماذا اخترت هذا الموضوع؟ ما الذي يدفعك إليه؟',
    en: 'Great. Why this subject? What draws you to it?',
    helpAr: 'معرفة دافعك تساعدني على اختيار الزاوية المناسبة. مثلًا: لعملك، لدراسة جامعية، لفضول شخصي، أو لكتابة بحث.',
    helpEn: 'Knowing your reason helps me pick the right angle: for work, a degree, personal curiosity, or writing research.',
    options: [
      { value: 'curiosity', ar: 'فضول وحب معرفة', en: 'Curiosity' },
      { value: 'work', ar: 'لعملي أو مهنتي', en: 'For my work' },
      { value: 'study', ar: 'لدراستي الجامعية', en: 'For my studies' },
      { value: 'research', ar: 'لكتابة بحث أو رسالة', en: 'To write research' },
    ],
    free: true,
  },
  prior_knowledge: {
    ar: 'ماذا تعرف عن هذا الموضوع حاليًا؟',
    en: 'How much do you already know about it?',
    helpAr: 'لا يوجد جواب خاطئ. هذا يحدد من أين نبدأ: من الأساسيات أم من نقطة متقدمة.',
    helpEn: 'There is no wrong answer — it tells me where to start.',
    options: [
      { value: 'none', ar: 'لا أعرف شيئًا تقريبًا', en: 'Almost nothing' },
      { value: 'basic', ar: 'أعرف أساسيات عامة', en: 'The basics' },
      { value: 'intermediate', ar: 'قرأت فيه بعض الكتب', en: 'I have read some books' },
      { value: 'advanced', ar: 'لدي خلفية متخصصة', en: 'Specialist background' },
    ],
    free: true,
  },
  depth: {
    ar: 'ما العمق الذي تريده؟',
    en: 'How deep do you want to go?',
    helpAr: 'المعرفة العامة تعطيك صورة واضحة شاملة. التخصص العميق يدخل في المدارس والمسائل الدقيقة. الإعداد البحثي يهيئك لقراءة الأدبيات وكتابة بحث.',
    helpEn: 'General = a clear overall picture. Deep = schools and detailed questions. Research = preparing you to read the literature and write.',
    options: [
      { value: 'general', ar: 'معرفة عامة متينة', en: 'Solid general knowledge' },
      { value: 'deep', ar: 'تخصص عميق', en: 'Deep specialisation' },
      { value: 'research', ar: 'إعداد بحثي', en: 'Research preparation' },
    ],
    free: false,
  },
  outcome: {
    ar: 'تخيّل نهاية الرحلة: ما النتيجة التي تتمنى الوصول إليها؟',
    en: 'Picture the end of the journey: what result do you hope for?',
    helpAr: 'مثلًا: «أن أفهم أهم المدارس وأستطيع المقارنة بينها» أو «أن أقرأ الأبحاث الحديثة وأفهمها» أو «أن أكتب مقالًا متخصصًا».',
    helpEn: 'E.g. "compare the main schools", "read current papers with understanding", "write an expert article".',
    free: true,
  },
  focus: {
    ar: 'هل هناك جوانب تهمك أكثر من غيرها؟ وهل هناك ما لا تريد التوسع فيه؟',
    en: 'Are there aspects you care about most — or ones you would rather skip?',
    helpAr: 'يمكنك قول: «يهمني الجانب التاريخي ولا أريد التوسع في التفاصيل الرياضية»، أو اختر «اترك الأمر لك».',
    helpEn: 'E.g. "history matters most, skip the heavy maths" — or choose "leave it to you".',
    options: [{ value: 'balanced', ar: 'اترك الأمر لك', en: 'Leave it to you' }],
    free: true,
    skippable: true,
  },
  minutes_per_day: {
    ar: 'كم دقيقة تستطيع تخصيصها يوميًا؟',
    en: 'How many minutes a day can you give it?',
    helpAr: 'القليل المنتظم أنفع من الكثير المتقطع. يمكنك تغيير ذلك لاحقًا في أي وقت.',
    helpEn: 'A little, regularly, beats a lot occasionally. You can change it any time.',
    options: [
      { value: '5', ar: '5 دقائق', en: '5 min' },
      { value: '10', ar: '10 دقائق', en: '10 min' },
      { value: '20', ar: '20 دقيقة', en: '20 min' },
      { value: '30', ar: '30 دقيقة', en: '30 min' },
    ],
    free: true,
  },
  duration_weeks: {
    ar: 'كم تريد أن تستغرق الرحلة؟',
    en: 'How long should the journey take?',
    helpAr: 'سأوزع المحتوى على هذه المدة. الرحلة الأطول تعني تعمقًا أكبر بالجرعة اليومية نفسها.',
    helpEn: 'I will spread the content over this period. Longer means deeper at the same daily dose.',
    options: [
      { value: '4', ar: 'شهر', en: '1 month' },
      { value: '12', ar: 'ثلاثة أشهر', en: '3 months' },
      { value: '26', ar: 'ستة أشهر', en: '6 months' },
      { value: '52', ar: 'سنة', en: '1 year' },
    ],
    free: true,
  },
  detail: {
    ar: 'كيف تحب أن تكون المادة اليومية؟',
    en: 'How should the daily material feel?',
    helpAr: 'المختصر جدًا: أهم ما ينبغي معرفته فقط. المتوسط: شرح مترابط مع أمثلة. المفصل: خلفية وتحليل ونقاش. وزر «المزيد» متاح دائمًا.',
    helpEn: 'Brief = only the essentials. Medium = connected explanation with examples. Detailed = background, analysis, debate. "More" is always available.',
    options: [
      { value: 'brief', ar: 'مختصر جدًا', en: 'Very brief' },
      { value: 'medium', ar: 'متوسط', en: 'Medium' },
      { value: 'detailed', ar: 'مفصل', en: 'Detailed' },
    ],
    free: false,
  },
  source_pref: {
    ar: 'أي المصادر تفضّل؟',
    en: 'Which sources do you prefer?',
    helpAr: 'الكتب الأصلية: المؤلفات المؤسسة للمجال. الأبحاث الحديثة: الدراسات المحكمة المعاصرة. أو الجمع بينهما بتوازن.',
    helpEn: 'Original works = the founding texts. Recent research = current peer-reviewed studies. Or a balance.',
    options: [
      { value: 'classic', ar: 'الكتب الأصلية', en: 'Original works' },
      { value: 'modern', ar: 'الأبحاث الحديثة', en: 'Recent research' },
      { value: 'both', ar: 'الجمع بينهما', en: 'Both' },
    ],
    free: false,
  },
  follow_updates: {
    ar: 'هل تريد أن أتابع لك المستجدات العلمية في هذا المجال؟',
    en: 'Shall I keep you posted on new research in this field?',
    helpAr: 'سأبحث دوريًا عن الدراسات الجديدة وأعرض عليك المهم منها فقط، ولن أضيف شيئًا إلى خطتك دون موافقتك.',
    helpEn: 'I will periodically look for new studies and only show the important ones. Nothing is added to your plan without your consent.',
    options: [
      { value: 'yes', ar: 'نعم', en: 'Yes' },
      { value: 'no', ar: 'لا، الآن', en: 'Not now' },
    ],
    free: false,
  },
  modality: {
    ar: 'أخيرًا: كيف تفضّل أن تتعلم؟',
    en: 'Lastly: how do you prefer to learn?',
    helpAr: 'القراءة، أو الاستماع (أقرأ لك المادة بصوت)، أو الحوار والمناقشة، أو الجمع بينها.',
    helpEn: 'Reading, listening (I read it aloud), dialogue, or a mix.',
    options: [
      { value: 'read', ar: 'القراءة', en: 'Reading' },
      { value: 'listen', ar: 'الاستماع', en: 'Listening' },
      { value: 'dialogue', ar: 'الحوار', en: 'Dialogue' },
      { value: 'mixed', ar: 'الجمع بينها', en: 'A mix' },
    ],
    free: false,
  },
};

export type InterviewState = {
  slots: Slots;
  history: { slot: SlotKey; question: string; answer: string; prevSlots: Slots }[];
  current: SlotKey | null;
  currentQuestion?: { text: string; options: { value: string; label: string }[] };
};

export type NextQuestion = {
  slot: SlotKey;
  text: string;
  options: { value: string; label: string }[];
  free: boolean;
  skippable: boolean;
  step: number;
  total: number;
};

export function missingSlots(s: Slots): SlotKey[] {
  return SLOT_ORDER.filter((k) => s[k] === undefined || s[k] === '');
}

export function defaultQuestion(slot: SlotKey, lang: Lang, slots: Slots): NextQuestion {
  const d = QUESTIONS[slot];
  const done = SLOT_ORDER.length - missingSlots(slots).length;
  return {
    slot,
    text: lang === 'ar' ? d.ar : d.en,
    options: (d.options ?? []).map((o) => ({ value: o.value, label: lang === 'ar' ? o.ar : o.en })),
    free: d.free,
    skippable: !!d.skippable,
    step: done + 1,
    total: SLOT_ORDER.length,
  };
}

export function helpFor(slot: SlotKey, lang: Lang) {
  return lang === 'ar' ? QUESTIONS[slot].helpAr : QUESTIONS[slot].helpEn;
}

/** Rule-based understanding: works without AI. Returns slot updates. */
/** "I want to dig deeper into X" -> "X" (rule-based; the AI does this better when available). */
export function cleanTopic(raw: string): string {
  let t = raw.trim().replace(/[.!؟?،,]+$/, '');
  const prefixes = [
    /^(?:انا |أنا )?(?:اريد|أريد|اود|أود|احب|أحب|ابغى|أبغى|ودي|نفسي|اتمنى|أتمنى)\s+(?:ان|أن)?\s*/,
    /^(?:اتعمق|أتعمق|افهم|أفهم|اتعلم|أتعلم|اعرف|أعرف|اقرا|أقرأ|ادرس|أدرس|اتابع|أتابع|اصبح|أصبح)\s+(?:اكثر\s+|أكثر\s+)?(?:معرفه\s+|معرفة\s+)?/,
    /^(?:في|فى|عن|ب|حول|كل ما يستجد في|كل ما يستجد فى)\s+/,
    /^(?:i\s+)?(?:want|would like|wish)\s+to\s+(?:learn|understand|study|dig deeper into|go deep(?:er)? into|know more about|master|follow)\s+(?:about\s+)?/i,
  ];
  for (let i = 0; i < 3; i++) for (const re of prefixes) t = t.replace(re, '');
  t = t.replace(/[،,]\s*(?:لكن|ولكن|but)\s.*$/i, '').trim();
  return t.length >= 2 ? t : raw.trim();
}

export function ruleExtract(slot: SlotKey, raw: string, choice?: string): Partial<Slots> {
  const text = normalizeDigits(raw.trim());
  const n = normalizeText(text);
  const out: Partial<Slots> = {};
  const val = choice ?? '';
  switch (slot) {
    case 'minutes_per_day': {
      const m = val || (text.match(/\d+/)?.[0] ?? '');
      let minutes = Number(m);
      if (!minutes) {
        if (/خمس/.test(n)) minutes = 5;
        else if (/عشر/.test(n) && !/عشرين/.test(n)) minutes = 10;
        else if (/عشرين|ثلث ساعه/.test(n)) minutes = 20;
        else if (/نصف ساعه|ثلاثين/.test(n)) minutes = 30;
        else if (/ساعه/.test(n)) minutes = 60;
      } else if (/ساع|hour/.test(n) && minutes <= 4) minutes *= 60;
      if (minutes) out.minutes_per_day = Math.min(120, Math.max(3, minutes));
      break;
    }
    case 'duration_weeks': {
      if (val) {
        out.duration_weeks = Number(val);
        break;
      }
      const num = Number(text.match(/\d+/)?.[0] ?? '') || 1;
      if (/سن|عام|year/.test(n)) out.duration_weeks = 52 * num;
      else if (/شهر|month/.test(n)) out.duration_weeks = Math.round(4.3 * (/شهرين/.test(n) ? 2 : num));
      else if (/اسبوع|week/.test(n)) out.duration_weeks = num;
      if (out.duration_weeks) out.duration_weeks = Math.min(156, Math.max(1, out.duration_weeks));
      break;
    }
    case 'follow_updates':
      if (val) out.follow_updates = val === 'yes';
      else if (/^(نعم|اجل|أجل|بالتاكيد|طبعا|yes|sure|ok)/.test(n)) out.follow_updates = true;
      else if (/^(لا|كلا|no|not)/.test(n)) out.follow_updates = false;
      break;
    case 'depth':
      if (val) out.depth = val;
      else if (/بحث|research|رساله/.test(n)) out.depth = 'research';
      else if (/عميق|تخصص|deep|special/.test(n)) out.depth = 'deep';
      else if (/عام|general|overview/.test(n)) out.depth = 'general';
      break;
    case 'detail':
      if (val) out.detail = val;
      else if (/مختصر|brief|short/.test(n)) out.detail = 'brief';
      else if (/مفصل|detail|long/.test(n)) out.detail = 'detailed';
      else if (/متوسط|medium/.test(n)) out.detail = 'medium';
      break;
    case 'source_pref':
      if (val) out.source_pref = val;
      else if (/كلا|كليهما|الجمع|both/.test(n)) out.source_pref = 'both';
      else if (/اصلي|تراث|classic|original/.test(n)) out.source_pref = 'classic';
      else if (/حديث|modern|recent/.test(n)) out.source_pref = 'modern';
      break;
    case 'modality':
      if (val) out.modality = val;
      else if (/استماع|صوت|listen|audio/.test(n)) out.modality = 'listen';
      else if (/حوار|نقاش|dialog|discuss/.test(n)) out.modality = 'dialogue';
      else if (/قراءه|read/.test(n)) out.modality = 'read';
      else if (text) out.modality = 'mixed';
      break;
    default: {
      const v = choice ? (QUESTIONS[slot].options?.find((o) => o.value === choice)?.[/[؀-ۿ]/.test(raw) ? 'ar' : 'en'] ?? choice) : text;
      if (v) (out as Record<string, unknown>)[slot] = slot === 'prior_knowledge' && choice ? choice : slot === 'topic' ? cleanTopic(v) : v;
    }
  }
  return out;
}

const TurnSchema = z.object({
  understood: z.object({
    topic: z.string().nullable(),
    motivation: z.string().nullable(),
    prior_knowledge: z.string().nullable(),
    depth: z.enum(['general', 'deep', 'research']).nullable(),
    outcome: z.string().nullable(),
    focus: z.string().nullable(),
    minutes_per_day: z.number().nullable(),
    duration_weeks: z.number().nullable(),
    detail: z.enum(['brief', 'medium', 'detailed']).nullable(),
    source_pref: z.enum(['classic', 'modern', 'both']).nullable(),
    follow_updates: z.boolean().nullable(),
    modality: z.enum(['read', 'listen', 'dialogue', 'mixed']).nullable(),
  }),
  needs_clarification: z.boolean(),
  clarification: z.string().nullable(),
  acknowledgement: z.string(),
  next_question: z.string().nullable(),
  next_options: z.array(z.string()),
});

const SYSTEM = `You are the Interview Agent of "Manara", a personal knowledge companion.
Goal: understand the learner through a short, warm, natural conversation — ONE question at a time.
Rules:
- Extract ONLY what the learner actually said or clearly implied. Never invent preferences. Leave a field null if unknown.
- A single answer may fill several fields (e.g. "10 minutes a day for a year" fills minutes_per_day and duration_weeks).
- If the answer to the asked field is vague or off-topic, set needs_clarification=true and write one short, kind clarification that offers concrete examples or choices.
- acknowledgement: one short sentence reflecting what you understood (no flattery).
- next_question: phrase the question for the FIRST still-missing field (given to you), adapted to the learner's topic, simple words, max 2 sentences. Null if nothing is missing.
- next_options: 2-5 short quick-reply suggestions that fit that question and topic (may be empty for open questions).
- Write in the requested language. Plain text, no markdown.`;

export async function aiTurn(
  ai: LLM,
  lang: Lang,
  state: InterviewState,
  answer: string,
): Promise<{ updates: Partial<Slots>; clarification: string | null; ack: string; nextText: string | null; nextOptions: string[] }> {
  const asked = state.current!;
  const prompt = JSON.stringify({
    language: lang === 'ar' ? 'Arabic' : 'English',
    known_so_far: state.slots,
    field_just_asked: asked,
    question_asked: state.currentQuestion?.text ?? QUESTIONS[asked][lang],
    learner_answer: answer,
    fields_in_order: SLOT_ORDER,
    field_meanings: {
      prior_knowledge: 'none|basic|intermediate|advanced or short description',
      depth: 'general|deep|research',
      focus: 'aspects to emphasise and aspects to avoid',
      duration_weeks: 'total journey length in weeks',
    },
  });
  const r = await ai.json({ task: 'interview', tier: 'fast', system: SYSTEM, prompt: `Conversation state:\n${prompt}\n\nAfter applying your extraction, the first missing field in fields_in_order is the one to ask next.`, schema: TurnSchema });
  const updates: Partial<Slots> = {};
  for (const [k, v] of Object.entries(r.understood)) {
    if (v !== null && v !== '' && (state.slots as Record<string, unknown>)[k] === undefined) (updates as Record<string, unknown>)[k] = v;
  }
  // The field just asked can be overwritten (it's the user's direct answer).
  const direct = (r.understood as Record<string, unknown>)[asked];
  if (direct !== null && direct !== undefined && direct !== '') (updates as Record<string, unknown>)[asked] = direct;
  if (updates.minutes_per_day) updates.minutes_per_day = Math.min(120, Math.max(3, Math.round(updates.minutes_per_day)));
  if (updates.duration_weeks) updates.duration_weeks = Math.min(156, Math.max(1, Math.round(updates.duration_weeks)));
  return {
    updates,
    clarification: r.needs_clarification ? r.clarification : null,
    ack: r.acknowledgement,
    nextText: r.next_question,
    nextOptions: r.next_options,
  };
}

export { llm };
