import type { z } from 'zod';
import type { ChatMsg, LLM, WebResearch } from './llm.ts';

/**
 * DECLARED DEMO MODE (MANARA_AI=demo).
 * Lets someone try the full experience without an API key. Everything it
 * produces is generic, labelled as demo content in the UI, carries NO sources
 * and NO citations, and never pretends to be scholarship.
 */
const isAr = (s: string) => /[؀-ۿ]/.test(s);

export class DemoLLM implements LLM {
  mode = 'demo' as const;

  async webResearch(): Promise<WebResearch> {
    return { text: '', citations: [], results: [] };
  }

  async chat(o: { system: string; messages: ChatMsg[] }): Promise<string> {
    const last = o.messages[o.messages.length - 1]?.content ?? '';
    return isAr(last) || isAr(o.system)
      ? `(وضع تجريبي) هذا رد نموذجي لعرض طريقة عمل المرافق، وليس إجابة علمية. في التشغيل الفعلي سأجيب عن سؤالك «${last.slice(0, 80)}» اعتمادًا على مادة اليوم ومصادرها الموثقة، وأربطه بما تعلمته سابقًا، وأوضح مواضع الخلاف وحدود المعرفة المتاحة.`
      : `(Demo mode) This is a placeholder reply showing how the companion works — not a scholarly answer. In real use I would answer "${last.slice(0, 80)}" from today's lesson and its verified sources.`;
  }

  async json<S extends z.ZodType>(o: { task: string; prompt: string }): Promise<z.infer<S>> {
    const p = (() => {
      try {
        return JSON.parse(o.prompt);
      } catch {
        return {};
      }
    })();
    const ar = (p.language ?? '').startsWith('Arabic') || isAr(o.prompt);
    const topic: string = p.interview?.topic ?? p.learner?.topic ?? (ar ? 'الموضوع' : 'the subject');
    switch (o.task) {
      case 'goal':
        return {
          statement: ar
            ? `فهمت أنك تريد بناء معرفة متدرجة في «${topic}»، تبدأ بالمفاهيم والجذور، ثم تنتقل إلى المحاور والمدارس الكبرى، ثم المسائل المعاصرة، بجرعة يومية قدرها ${p.interview?.minutes_per_day ?? 10} دقائق. هل هذا ما تقصده؟`
            : `I understand you want to build layered knowledge of "${topic}": concepts and roots first, then major schools, then contemporary questions, ${p.interview?.minutes_per_day ?? 10} minutes a day. Is that right?`,
          title: ar ? `رحلة في ${topic}` : `A journey into ${topic}`,
          scope_in: [],
          scope_out: [],
          prerequisites: [],
          field_nature: 'mixed',
          map_model: 'tree',
          start_level: 'foundations',
        } as z.infer<S>;
      case 'plan':
        return demoPlan(topic, ar) as z.infer<S>;
      case 'synthesis':
        return demoLesson(o.prompt, ar) as z.infer<S>;
      case 'cumulative':
        return {
          overview: ar ? '(وضع تجريبي) ملخص تراكمي نموذجي مبني على عناوين المواد التي قرأتها.' : '(Demo) A placeholder cumulative summary built from your lesson titles.',
          key_ideas: (p.lessons_in_order ?? []).map((l: { title: string }) => l.title),
          evolution: ar ? 'في التشغيل الفعلي يتتبع هذا القسم كيف تطور فهمك من المادة الأولى إلى الأخيرة.' : 'In real use this traces how your understanding developed.',
          connections: [],
          gaps: p.weak_topics ?? [],
          next_focus: (p.not_studied_yet ?? [])[0] ?? '',
        } as z.infer<S>;
      default:
        throw new Error(`demo: unsupported task ${o.task}`);
    }
  }
}

function demoPlan(topic: string, ar: boolean) {
  const t = (a: string, e: string) => (ar ? a : e);
  const stages = [
    { title: t('الجذور والمفاهيم', 'Roots and concepts'), description: t('المصطلحات الأساسية والسياق الذي نشأ فيه المجال.', 'Core terms and the context the field grew from.'), weeks: 2 },
    { title: t('المحاور والمدارس', 'Axes and schools'), description: t('المبادئ الكبرى والاتجاهات الرئيسة.', 'Major principles and main schools.'), weeks: 3 },
    { title: t('المسائل المعاصرة', 'Contemporary questions'), description: t('القضايا الحديثة والدراسات الجديدة.', 'Current issues and recent studies.'), weeks: 2 },
  ];
  const n = (key: string, parent: string | null, stage: number, kind: string, a: string, e: string, teach = true, weight = 1) => ({
    key, parent_key: parent, stage_index: stage, kind, title: t(a, e), summary: t(`(تجريبي) ${a}`, `(demo) ${e}`), teach, weight, search_queries: [], source_ids: [],
  });
  return {
    title: t(`رحلة في ${topic}`, `A journey into ${topic}`),
    overview: t(
      `(خطة تجريبية عامة لعرض الواجهة، غير مبنية على بحث في المصادر.) ستبدأ بالمفاهيم والجذور، ثم المحاور والمدارس، ثم المسائل المعاصرة. ستصلك كل يوم مادة قصيرة، ويمكنك طلب المزيد متى أردت.`,
      `(Generic demo plan for trying the interface — not research-based.) You start with concepts and roots, move to the main schools, then contemporary questions. One short unit a day; ask for more any time.`,
    ),
    stages,
    nodes: [
      n('r1', null, 0, 'root', `مدخل إلى ${topic}`, `Introduction to ${topic}`, true, 1),
      n('r2', 'r1', 0, 'root', 'المصطلحات الأساسية', 'Key terms', true, 1),
      n('r3', 'r1', 0, 'root', 'السياق التاريخي والفكري', 'Historical and intellectual context', true, 1),
      n('t1', 'r1', 1, 'trunk', 'المبادئ الكبرى', 'Major principles', true, 1),
      n('b1', 't1', 1, 'branch', 'المدرسة أو الاتجاه الأول', 'First school or approach', true, 1),
      n('b2', 't1', 1, 'branch', 'المدرسة أو الاتجاه الثاني', 'Second school or approach', true, 1),
      n('b3', 't1', 1, 'branch', 'مواطن الاتفاق والخلاف', 'Agreements and disagreements', true, 1),
      n('l1', 'b3', 2, 'leaf', 'مسألة معاصرة', 'A contemporary question', true, 1),
      n('l2', 'b3', 2, 'leaf', 'الدراسات الحديثة', 'Recent studies', true, 1),
    ],
    relations: [
      { from: 'r3', to: 'b1', type: 'historical', note: t('السياق الذي نشأ فيه الاتجاه', 'Context of origin') },
      { from: 'b1', to: 'b2', type: 'disagreement', note: t('نقاط الخلاف بين الاتجاهين', 'Points of disagreement') },
      { from: 'r2', to: 't1', type: 'prerequisite', note: t('فهم المصطلحات قبل المبادئ', 'Terms before principles') },
    ],
    review_policy: t('مراجعة قصيرة كل يومين لما سبق، متناسبة مع وقتك.', 'Short review every other day, sized to your time.'),
    updates_policy: null,
  };
}

function demoLesson(prompt: string, ar: boolean) {
  const title = prompt.match(/Study unit: "([^"]+)"/)?.[1] ?? (ar ? 'مادة تجريبية' : 'Demo unit');
  const para = (text: string) => ({ text, type: 'inference' as const, certainty: 'low' as const, cites: [], quote: null, holder: null });
  return ar
    ? {
        title,
        key_question: `ما الفكرة المحورية في «${title}»؟`,
        summary: [
          para(`هذه مادة تجريبية تعرض شكل الجرعة اليومية في «${title}». في التشغيل الفعلي تُكتب هذه الخلاصة من مصادر عُثر عليها بالبحث الحي، ويُربط كل ادعاء بمقتطف من مصدره.`),
          para('تتدرج المادة في خمسة مستويات: الخلاصة، ثم المفاهيم، ثم الخلفية، ثم الأدلة والمناقشات، ثم المصادر للتوسع. جرّب زر «المزيد» للانتقال بينها.'),
        ],
        concepts: [
          { term: 'الجرعة المعرفية', definition: 'مادة يومية قصيرة مركزة تبني على ما قبلها.', cites: [] },
          { term: 'الخريطة المعرفية', definition: 'تصور بصري لموقع كل مادة من المجال وعلاقاتها.', cites: [] },
        ],
        background: [para('في المستوى الثالث يُعرض السياق التاريخي والفكري للموضوع، مع بيان أصل الأفكار وتطورها.')],
        evidence: [para('في المستوى الرابع تُعرض الأدلة والأقوال الرئيسة وأصحابها، مع تقييم قوتها وبيان مواضع الخلاف.')],
        positions: [],
        further_reading: [],
        links_to_previous: [],
        uncertainty_note: 'وضع تجريبي: لا توجد مصادر ولا توثيق في هذه المادة، فلا يُعتمد عليها علميًا.',
        review_questions: [
          { question: 'ما المستويات الخمسة للمادة اليومية؟', answer: 'الخلاصة، المفاهيم، الخلفية، الأدلة والمناقشات، المصادر للتوسع.', cites: [] },
          { question: 'ما الذي يميز المادة الفعلية عن هذه المادة التجريبية؟', answer: 'أنها مبنية على مصادر حقيقية ومقتطفات موثقة لكل ادعاء.', cites: [] },
        ],
      }
    : {
        title,
        key_question: `What is the central idea of "${title}"?`,
        summary: [
          para(`This is a demo unit showing the shape of a daily dose on "${title}". In real use this summary is written from sources found by live search, and every claim is tied to an excerpt.`),
          para('The unit has five levels: summary, concepts, background, evidence and debates, further sources. Try "More" to move between them.'),
        ],
        concepts: [{ term: 'Daily dose', definition: 'A short focused unit that builds on the previous ones.', cites: [] }],
        background: [para('Level 3 presents historical and intellectual context.')],
        evidence: [para('Level 4 presents evidence, positions and who holds them, with their strength.')],
        positions: [],
        further_reading: [],
        links_to_previous: [],
        uncertainty_note: 'Demo mode: no sources or citations — not for study.',
        review_questions: [{ question: 'What are the five levels of a unit?', answer: 'Summary, concepts, background, evidence/debates, further sources.', cites: [] }],
      };
}
