import { z } from 'zod';
import type { ChatMsg, LLM } from './llm.ts';
import type { Lang } from './interview.ts';

/** ---------------- Tutor Agent ---------------- */
export type TutorContext = {
  lang: Lang;
  goal: string;
  journeyTitle: string;
  stage: string;
  detail: string;
  lesson: { title: string; text: string } | null;
  sources: { sid: string; title: string; authors?: string | null; year?: string | null }[];
  earlier: { title: string; concepts: string[] }[];
  notes: string[];
  mode: 'discuss' | 'explain' | 'simplify' | 'link' | 'free' | 'summarize_text';
};

export function tutorSystem(c: TutorContext) {
  return `You are the Tutor of "Manara", the learner's personal knowledge companion. Reply in ${c.lang === 'ar' ? 'Arabic' : 'English'}.
You know the learner's context, so never ask them to repeat it:
- Journey: ${c.journeyTitle}. Goal: ${c.goal}. Current stage: ${c.stage}. Preferred detail: ${c.detail}.
- Current lesson: ${c.lesson ? c.lesson.title : 'none'}.
- Earlier lessons and their concepts: ${JSON.stringify(c.earlier.slice(-20))}
- Learner's recent notes: ${JSON.stringify(c.notes.slice(-5))}
Lesson sources you may cite as [S#]: ${JSON.stringify(c.sources)}
Rules:
- Teach Socratically when discussing: ask one probing question at a time, correct misunderstandings gently and precisely.
- Ground claims in the lesson and its sources and cite them as [S#]. If you go beyond them, say explicitly that it is general background not documented in this journey's sources, and keep it cautious. Never invent references, quotations or page numbers.
- Distinguish fact, inference and opinion; mention scholarly disagreement where it exists.
- When linking to earlier lessons, name them and explain the real relation (historical, conceptual, influence, disagreement, application).
- Keep answers focused (under ~180 words unless asked for more). Plain text; short paragraphs or simple dashes.
${c.lesson ? `\nCURRENT LESSON TEXT:\n${c.lesson.text.slice(0, 9000)}` : ''}`;
}

export async function tutorReply(ai: LLM, c: TutorContext, history: ChatMsg[]): Promise<string> {
  return ai.chat({ task: 'tutor', tier: c.mode === 'free' || c.mode === 'link' ? 'strong' : 'fast', system: tutorSystem(c), messages: history.slice(-16) });
}

/** ---------------- Progress Agent: cumulative synthesis ---------------- */
const CumulativeSchema = z.object({
  overview: z.string(),
  key_ideas: z.array(z.string()),
  evolution: z.string(), // how understanding developed from the start
  connections: z.array(z.string()),
  gaps: z.array(z.string()),
  next_focus: z.string(),
});
export type Cumulative = z.infer<typeof CumulativeSchema>;

export async function cumulativeSummary(ai: LLM, lang: Lang, goal: string, lessons: { title: string; summary: string; concepts: string[] }[], weak: string[], remaining: string[]): Promise<Cumulative> {
  return ai.json({
    task: 'cumulative',
    tier: 'strong',
    effort: 'medium',
    system: `You are the Progress Agent of "Manara". Using ONLY the learner's studied lessons below, write a cumulative synthesis in ${lang === 'ar' ? 'Arabic' : 'English'}: what they now know, how the ideas built on each other from the first lesson to the latest, the connections between them, the gaps (weakly-reviewed topics) and what to focus on next. Do not add facts that are not in the lessons.`,
    prompt: JSON.stringify({ goal, lessons_in_order: lessons, weak_topics: weak, not_studied_yet: remaining }),
    schema: CumulativeSchema,
  });
}

/** ---------------- Updates agent (scientific news watch) ---------------- */
export const UpdatesSchema = z.object({
  items: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      published: z.string().nullable(),
      summary: z.string(),
      category: z.enum(['important', 'regular', 'opinion', 'unconfirmed', 'preliminary']),
      relation: z.string(),
      recommend_add: z.boolean(),
    }),
  ),
});
