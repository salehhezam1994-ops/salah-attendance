import { z } from 'zod';
import type { LLM } from './llm.ts';
import type { Lang } from './interview.ts';

const ParagraphSchema = z.object({
  text: z.string(),
  type: z.enum(['fact', 'inference', 'opinion']),
  certainty: z.enum(['high', 'medium', 'low']),
  cites: z.array(z.string()),
  quote: z.object({ text: z.string(), cite: z.string() }).nullable(),
  holder: z.string().nullable(),
});

export const LessonSchema = z.object({
  title: z.string(),
  key_question: z.string(),
  summary: z.array(ParagraphSchema),
  concepts: z.array(z.object({ term: z.string(), definition: z.string(), cites: z.array(z.string()) })),
  background: z.array(ParagraphSchema),
  evidence: z.array(ParagraphSchema),
  positions: z.array(
    z.object({
      position: z.string(),
      holders: z.string(),
      arguments: z.string(),
      strength: z.enum(['strong', 'moderate', 'weak', 'contested']),
      cites: z.array(z.string()),
    }),
  ),
  further_reading: z.array(z.object({ sid: z.string(), why: z.string(), locator: z.string().nullable() })),
  links_to_previous: z.array(z.object({ lesson: z.string(), relation: z.string() })),
  uncertainty_note: z.string().nullable(),
  review_questions: z.array(z.object({ question: z.string(), answer: z.string(), cites: z.array(z.string()) })),
});
export type LessonDraft = z.infer<typeof LessonSchema>;

const SYSTEM = `You are the Synthesis Agent of "Manara", writing one focused daily study unit for a learner.
Scholarly honesty rules (strict):
- Ground every factual statement in the numbered EXCERPTS (E-ids). Put the supporting E-ids in "cites". Do not cite an E-id that does not support the sentence.
- Never invent sources, quotations, page numbers, dates or attributions. A "quote" must be copied character-for-character from the cited excerpt; otherwise use null and paraphrase.
- type: "fact" (stated by sources), "inference" (your reasoned conclusion from sources — say so in the text), "opinion" (a position held by someone; put who in "holder").
- certainty: lower it when sources are few, old, secondary, or disagree. Mention real disagreements; do not flatten a debate into one view, and do not present weak views as equal to strong ones (use positions[].strength).
- If the excerpts are insufficient for part of the topic, say so in uncertainty_note instead of filling gaps from memory. You MAY add widely-known orienting context only as type "inference" with certainty "low" and no cites.
- Distinguish original/primary sources from secondary ones in further_reading (use only S-ids given). locator: chapter/section/page ONLY if it appears in an excerpt; otherwise null.
Structure (the learner opens deeper levels with "More"):
- summary: the essential idea (level 1). Length by detail preference: brief = 2 short paragraphs; medium = 3-4; detailed = 5-6.
- concepts: 3-6 key terms with precise definitions (level 2).
- background: historical/intellectual context (level 3).
- evidence + positions: arguments, evidence, debates and who holds which view (level 4).
- further_reading: which sources to read next and why (level 5).
- links_to_previous: connect to earlier lessons by title when there is a real link (empty if none).
- review_questions: 3-4 recall questions with short model answers grounded in the excerpts.
Write in the requested language, clear and dense, no filler, no markdown.`;

export async function synthesizeLesson(
  ai: LLM,
  o: {
    lang: Lang;
    goal: string;
    detail: string;
    level: string;
    nodeTitle: string;
    nodeSummary: string;
    part: number;
    parts: number;
    previousParts: string[];
    previousLessons: { title: string; concepts: string[] }[];
    notes: string;
    sources: { sid: string; title: string; kind: string; authors?: string | null; year?: string | null; primary: boolean }[];
    excerpts: { eid: string; sid: string; text: string }[];
  },
): Promise<LessonDraft> {
  const prompt = [
    `Language: ${o.lang === 'ar' ? 'Arabic' : 'English'}. Detail preference: ${o.detail}. Learner level: ${o.level}.`,
    `Journey goal: ${o.goal}`,
    `Study unit: "${o.nodeTitle}" — ${o.nodeSummary}`,
    o.parts > 1 ? `This is part ${o.part} of ${o.parts} on this unit. Earlier parts covered: ${o.previousParts.join(' | ') || '—'}. Cover a NEW facet; do not repeat.` : '',
    `Earlier lessons in the journey (for linking): ${JSON.stringify(o.previousLessons.slice(-12))}`,
    `SOURCES:\n${o.sources.map((s) => `${s.sid}: ${s.title}${s.authors ? ' — ' + s.authors : ''}${s.year ? ' (' + s.year + ')' : ''} [${s.kind}${s.primary ? ', primary' : ''}]`).join('\n')}`,
    `EXCERPTS (verbatim text from the sources):\n${o.excerpts.map((e) => `${e.eid} [${e.sid}]: ${e.text}`).join('\n\n')}`,
    o.notes ? `Research notes (orientation only; cite excerpts, not these notes):\n${o.notes.slice(0, 6000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return ai.json({ task: 'synthesis', tier: 'strong', system: SYSTEM, prompt, schema: LessonSchema, effort: 'high' });
}
