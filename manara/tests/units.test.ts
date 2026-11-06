import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTopic, ruleExtract, missingSlots } from '../server/ai/interview.ts';
import { validateParagraph, emptyReport, type ExcerptIndex } from '../server/ai/verify.ts';
import { schedule, dailyReviewBudget } from '../server/ai/review.ts';
import { ruleChange } from '../server/ai/planner.ts';
import { parseSourcesJson, extractDoi, webResearch } from '../server/ai/research.ts';
import { detectIntent } from '../server/services/companion.ts';
import type { LLM } from '../server/ai/llm.ts';

test('interview: topic is extracted from a natural sentence', () => {
  assert.equal(cleanTopic('أريد أن أتعمق في علم الكلام الجديد'), 'علم الكلام الجديد');
  assert.equal(cleanTopic('أريد أن أفهم الذكاء الاصطناعي، لكن لا أعرف من أين أبدأ.'), 'الذكاء الاصطناعي');
  assert.equal(cleanTopic('I want to learn about behavioral economics'), 'behavioral economics');
  assert.equal(cleanTopic('تاريخ الأندلس'), 'تاريخ الأندلس');
});

test('interview: rule extraction understands time answers in Arabic', () => {
  assert.deepEqual(ruleExtract('minutes_per_day', 'عشر دقائق'), { minutes_per_day: 10 });
  assert.deepEqual(ruleExtract('minutes_per_day', '١٥ دقيقة'), { minutes_per_day: 15 });
  assert.deepEqual(ruleExtract('minutes_per_day', 'نصف ساعة'), { minutes_per_day: 30 });
  assert.deepEqual(ruleExtract('duration_weeks', 'سنة'), { duration_weeks: 52 });
  assert.deepEqual(ruleExtract('duration_weeks', '3 أشهر'), { duration_weeks: 13 });
  assert.deepEqual(ruleExtract('follow_updates', 'نعم بالتأكيد'), { follow_updates: true });
  assert.deepEqual(ruleExtract('depth', 'أريد إعدادًا بحثيًا'), { depth: 'research' });
  assert.deepEqual(ruleExtract('depth', 'لا أدري'), {}); // not understood -> clarification, never a guess
  assert.equal(missingSlots({ topic: 'x' })[0], 'motivation');
});

const index: ExcerptIndex = new Map([
  ['E1', { excerptId: 'e1', sourceId: 's1', text: 'The school emerged in the nineteenth century as a response to modern philosophy.' }],
  ['E2', { excerptId: 'e2', sourceId: 's2', text: 'Critics argued that the method relied too heavily on rational theology.' }],
]);

test('citations: invented citation ids are dropped and the claim is flagged', () => {
  const r = emptyReport();
  const p = validateParagraph({ text: 'A fact.', type: 'fact', certainty: 'high', cites: ['E9'], quote: null }, index, r);
  assert.deepEqual(p.cites, []);
  assert.equal(p.unsupported, true);
  assert.equal(r.droppedCitations, 1);
  assert.equal(r.unsupported, 1);
});

test('citations: a quote must appear verbatim in its excerpt', () => {
  const r = emptyReport();
  const good = validateParagraph({ text: 'x', type: 'fact', certainty: 'high', cites: [], quote: { text: 'a response to modern philosophy', cite: 'E1' } }, index, r);
  assert.ok(good.quote);
  assert.deepEqual(good.cites, ['E1']);
  const bad = validateParagraph({ text: 'x', type: 'fact', certainty: 'high', cites: ['E2'], quote: { text: 'a revolution in all of thought', cite: 'E1' } }, index, r);
  assert.equal(bad.quote, null);
  assert.equal(r.quotesRejected, 1);
  assert.equal(r.quotesKept, 1);
});

test('citations: opinions attributed to a person need evidence; declared inferences do not', () => {
  const r = emptyReport();
  assert.equal(validateParagraph({ text: 'X held that…', type: 'opinion', certainty: 'medium', cites: [], quote: null, holder: 'X' }, index, r).unsupported, true);
  assert.equal(validateParagraph({ text: 'This suggests…', type: 'inference', certainty: 'low', cites: [], quote: null }, index, r).unsupported, false);
  assert.equal(r.uncited, 1);
});

test('research: a source not present in the real search results is rejected', async () => {
  const fake = {
    mode: 'anthropic',
    async webResearch() {
      return {
        text: 'Notes… SOURCES_JSON: [{"url":"https://real.example/book","kind":"book","authors":"A. Author","year":"1999","publisher":"","is_primary":true},{"url":"https://invented.example/fake","kind":"paper","authors":"Nobody","year":"2020","publisher":"","is_primary":false}]',
        citations: [{ url: 'https://real.example/book', title: 'Real Book', citedText: 'A verbatim line from the real page.' }],
        results: [{ url: 'https://real.example/book', title: 'Real Book', pageAge: null }, { url: 'https://other.example/x', title: 'Other', pageAge: null }],
      };
    },
  } as unknown as LLM;
  const r = await webResearch(fake, { topic: 't', focus: 'f', lang: 'en', goal: 'g', level: 'basic', sourcePref: 'both' });
  const urls = r.sources.map((s) => s.url);
  assert.deepEqual(urls, ['https://real.example/book']);
  assert.equal(r.sources[0].excerpts[0].text, 'A verbatim line from the real page.');
  assert.equal(r.sources[0].isPrimary, true);
  assert.equal(r.notes, 'Notes…');
});

test('research helpers', () => {
  assert.equal(extractDoi('https://doi.org/10.1000/xyz123.'), '10.1000/xyz123');
  assert.deepEqual(parseSourcesJson('no json'), []);
});

test('review scheduling grows intervals and resets on forgetting', () => {
  let it = { ease: 2.5, interval_days: 0, reps: 0, lapses: 0 };
  it = schedule(it, 'remembered');
  assert.equal(it.interval_days, 2);
  it = schedule(it, 'remembered');
  assert.equal(it.interval_days, 6);
  it = schedule(it, 'remembered');
  assert.ok(it.interval_days > 6);
  const f = schedule(it, 'forgot');
  assert.equal(f.interval_days, 1);
  assert.equal(f.lapses, 1);
  assert.ok(dailyReviewBudget(5) >= 2 && dailyReviewBudget(60) <= 12);
});

test('plan changes in natural language (rule fallback)', () => {
  const c = ruleChange('اجعل القراءة خمس دقائق يوميًا', { duration_weeks: 52, minutes_per_day: 10 }, 'ar')!;
  assert.equal(c.settings.minutes_per_day, 5);
  assert.equal(c.major, false);
  const f = ruleChange('اجعل الخطة أسرع', { duration_weeks: 52 }, 'ar')!;
  assert.equal(f.settings.duration_weeks, 39);
  assert.equal(f.major, false);
  assert.equal(ruleChange('شيء غير مفهوم', {}, 'ar'), null);
});

test('companion understands voice/typed commands', () => {
  assert.deepEqual(detectIntent('احفظ هذه الملاحظة: التعريف مهم'), { kind: 'save_note', body: 'التعريف مهم' });
  assert.equal(detectIntent('أين وصلنا؟').kind, 'where');
  assert.equal(detectIntent('اختبر فهمي').kind, 'quiz');
  assert.equal(detectIntent('انتقل إلى المادة التالية').kind, 'next');
  assert.equal(detectIntent('اربط هذا بما سبق').kind, 'link');
  assert.equal(detectIntent('ما معنى الحدوث؟').kind, 'ask');
});

test('research: database hits must match the topic, not just share a word', async () => {
  const { relevant } = await import('../server/ai/research.ts');
  const src = (title: string, text = '') => ({ url: 'u', title, kind: 'encyclopedia' as const, origin: 'wikipedia' as const, verified: true, excerpts: text ? [{ text, origin: 'summary' as const }] : [] });
  assert.equal(relevant(src('A. P. J. Abdul Kalam', 'Indian aerospace scientist and president'), ['new kalam']), false);
  assert.equal(relevant(src('New Kalam', 'A modern current of Islamic theology'), ['new kalam']), true);
  assert.equal(relevant(src('علم الكلام الجديد: مدخل'), ['علم الكلام الجديد']), true);
  assert.equal(relevant(src('الكلام في الفيزياء'), ['علم الكلام الجديد']), false);
  assert.equal(relevant(src('Islamic economics and finance: principles of banking'), ['principles of Islamic economics and banking']), true);
});
