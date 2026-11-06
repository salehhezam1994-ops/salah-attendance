import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * End-to-end API test with an in-memory database and a FAKE model provider
 * (the only place fakes are used). It exercises the real pipeline: interview →
 * goal → research → plan → approval → lesson synthesis → citation validation →
 * reading → review → companion → privacy → export/delete.
 */
process.env.SOURCE_TIMEOUT_MS = '300';
process.env.MANARA_DB_FILE = ':memory:';

const { setLlm } = await import('../server/ai/llm.ts');
const { createApp } = await import('../server/index.ts');
const { waitAll } = await import('../server/services/jobs.ts');

const calls: string[] = [];
setLlm({
  mode: 'anthropic',
  async webResearch(o: { task: string }) {
    calls.push(`web:${o.task}`);
    return {
      text: 'Research notes about the field. SOURCES_JSON: [{"url":"https://press.example/founding-work","kind":"book","authors":"Founding Author","year":"1950","publisher":"Univ. Press","is_primary":true},{"url":"https://journal.example/study","kind":"paper","authors":"R. Scholar","year":"2021","publisher":"Journal of X","is_primary":false},{"url":"https://made-up.example/ghost","kind":"paper","authors":"Ghost","year":"2024","publisher":"","is_primary":false}]',
      citations: [
        { url: 'https://press.example/founding-work', title: 'The Founding Work', citedText: 'The discipline begins with the question of how reason relates to revelation.' },
        { url: 'https://journal.example/study', title: 'A Modern Study', citedText: 'Recent scholarship distinguishes three main contemporary approaches.' },
      ],
      results: [
        { url: 'https://press.example/founding-work', title: 'The Founding Work', pageAge: null },
        { url: 'https://journal.example/study', title: 'A Modern Study', pageAge: '2021' },
      ],
    };
  },
  async chat(o: { task: string; messages: { content: string }[] }) {
    calls.push(`chat:${o.task}`);
    return `Tutor reply to: ${o.messages[o.messages.length - 1].content.slice(0, 40)} [S1]`;
  },
  async json(o: { task: string }) {
    calls.push(`json:${o.task}`);
    switch (o.task) {
      case 'interview':
        return { understood: { topic: null, motivation: null, prior_knowledge: null, depth: null, outcome: null, focus: null, minutes_per_day: null, duration_weeks: null, detail: null, source_pref: null, follow_updates: null, modality: null }, needs_clarification: false, clarification: null, acknowledgement: 'Noted.', next_question: null, next_options: [] };
      case 'goal':
        return { statement: 'I understand you want deep knowledge of new kalam. Is that right?', title: 'New kalam', scope_in: [], scope_out: [], prerequisites: [], field_nature: 'long_tradition', map_model: 'tree', start_level: 'foundations' };
      case 'plan':
        return {
          title: 'New kalam journey', overview: 'Overview.', review_policy: 'Short reviews.', updates_policy: null,
          stages: [{ title: 'Roots', description: 'd', weeks: 1 }, { title: 'Schools', description: 'd', weeks: 1 }],
          nodes: [
            { key: 'a', parent_key: null, stage_index: 0, kind: 'root', title: 'Foundations', summary: 's', teach: true, weight: 1, search_queries: ['q'], source_ids: ['S1', 'S99'] },
            { key: 'b', parent_key: 'a', stage_index: 1, kind: 'branch', title: 'Contemporary approaches', summary: 's', teach: true, weight: 1, search_queries: ['q'], source_ids: ['S2'] },
          ],
          relations: [{ from: 'a', to: 'b', type: 'historical', note: 'n' }, { from: 'a', to: 'zz', type: 'influence', note: 'invalid target' }],
        };
      case 'synthesis':
        return {
          title: 'Foundations', key_question: 'How does reason relate to revelation?',
          summary: [
            { text: 'The discipline starts from reason and revelation.', type: 'fact', certainty: 'high', cites: ['E1'], quote: { text: 'how reason relates to revelation', cite: 'E1' }, holder: null },
            { text: 'An invented claim.', type: 'fact', certainty: 'high', cites: ['E7'], quote: { text: 'words nobody wrote', cite: 'E2' }, holder: null },
            { text: 'This suggests a continuity.', type: 'inference', certainty: 'low', cites: [], quote: null, holder: null },
          ],
          concepts: [{ term: 'Kalam', definition: 'Rational theology.', cites: ['E1', 'E42'] }],
          background: [], evidence: [], positions: [{ position: 'Three approaches', holders: 'R. Scholar', arguments: 'a', strength: 'moderate', cites: ['E2'] }],
          further_reading: [{ sid: 'S1', why: 'Founding text', locator: null }, { sid: 'S77', why: 'ghost', locator: null }],
          links_to_previous: [], uncertainty_note: null,
          review_questions: [{ question: 'What relation starts the discipline?', answer: 'Reason and revelation.', cites: ['E1'] }],
        };
      case 'cumulative':
        return { overview: 'o', key_ideas: ['k'], evolution: 'e', connections: [], gaps: [], next_focus: 'n' };
      default:
        throw new Error('unexpected task ' + o.task);
    }
  },
} as never);

const app = createApp();
function client() {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data } as { status: number; data: any };
  };
}

test('full journey through the API', async () => {
  const api = client();
  assert.equal((await api('GET', '/me')).status, 401);
  assert.equal((await api('POST', '/auth/guest', { locale: 'en' })).status, 200);
  const me = await api('GET', '/me');
  assert.equal(me.data.ai, 'anthropic');

  const j = await api('POST', '/journeys', {});
  const id = j.data.id;
  assert.equal(j.data.question.slot, 'topic');

  // One question at a time; free text and quick replies.
  let r = await api('POST', `/journeys/${id}/interview/answer`, { text: 'I want to go deeper into new kalam' });
  assert.equal(r.data.question.slot, 'motivation');
  r = await api('POST', `/journeys/${id}/interview/back`);
  assert.equal(r.data.question.slot, 'topic');
  r = await api('POST', `/journeys/${id}/interview/answer`, { text: 'new kalam' });
  const answers: [string, string | undefined, string][] = [
    ['', 'curiosity', 'motivation'], ['', 'basic', 'prior_knowledge'], ['', 'deep', 'depth'], ['understand the main schools', undefined, 'outcome'], ['', 'balanced', 'focus'],
    ['10 minutes', undefined, 'minutes_per_day'], ['', '4', 'duration_weeks'], ['', 'medium', 'detail'], ['', 'both', 'source_pref'], ['', 'no', 'follow_updates'], ['', 'mixed', 'modality'],
  ];
  // An unclear structured answer triggers clarification instead of a guess.
  r = await api('POST', `/journeys/${id}/interview/answer`, { text: '', choice: 'curiosity' });
  r = await api('POST', `/journeys/${id}/interview/answer`, { text: '', choice: 'basic' });
  const unclear = await api('POST', `/journeys/${id}/interview/answer`, { text: 'hmm not sure' });
  assert.equal(unclear.data.question.slot, 'depth');
  for (const [text, choice] of answers.slice(2)) r = await api('POST', `/journeys/${id}/interview/answer`, { text, choice });
  assert.equal(r.data.done, true);
  assert.match(r.data.goal.statement, /understand/);

  assert.equal((await api('POST', `/journeys/${id}/goal`, { accept: true })).data.status, 'planning');
  await waitAll();
  const detail = await api('GET', `/journeys/${id}`);
  assert.equal(detail.data.journey.status, 'proposed');
  assert.equal(detail.data.stages.length, 2);
  assert.equal(detail.data.stages.reduce((a: number, s: any) => a + s.weeks, 0), 4, 'stage weeks fit the chosen duration');
  // Only real search results became sources; the ghost URL was rejected.
  const urls = detail.data.keySources.map((s: any) => s.url).sort();
  assert.deepEqual(urls, ['https://journal.example/study', 'https://press.example/founding-work']);
  assert.ok(detail.data.keySources.every((s: any) => s.verification_status !== 'verified'), 'search results are "located", not claimed as verified');

  // Plan must be approved before anything starts.
  const homeBefore = await api('GET', `/journeys/${id}/home`);
  assert.equal(homeBefore.data.status, 'proposed');
  assert.equal((await api('POST', `/journeys/${id}/approve`)).data.status, 'active');
  await waitAll();

  const home = await api('GET', `/journeys/${id}/home`);
  assert.equal(home.data.today.status, 'ready');
  const lessonId = home.data.today.id;
  const L = await api('GET', `/lessons/${lessonId}`);
  const summary = L.data.sections.find((s: any) => s.level === 1).body.paragraphs;
  assert.equal(summary[0].unsupported, false);
  assert.ok(summary[0].quote, 'verbatim quote kept');
  assert.equal(summary[1].unsupported, true, 'claim with an invented citation is flagged');
  assert.equal(summary[1].quote, null, 'non-verbatim quote removed');
  assert.equal(summary[2].unsupported, false, 'declared inference is not flagged');
  assert.equal(L.data.lesson.verification.droppedCitations, 1);
  assert.equal(L.data.lesson.verification.quotesRejected, 1);
  const further = L.data.sections.find((s: any) => s.level === 5).body.further;
  assert.equal(further.length, 1, 'further reading limited to real sources');
  assert.ok(L.data.excerpts.length >= 1);
  assert.equal(L.data.sections.length, 5);

  // "More", reading, saving, notes.
  assert.equal((await api('POST', `/lessons/${lessonId}/level`, { level: 3 })).status, 200);
  assert.equal((await api('POST', `/lessons/${lessonId}/save`, { saved: true })).status, 200);
  const read = await api('POST', `/lessons/${lessonId}/read`, { seconds: 240 });
  assert.ok(read.data.nextId);
  await waitAll();
  assert.equal((await api('POST', '/notes', { journeyId: id, lessonId, body: 'my note on reason' })).status, 200);

  // Review: due items appear only for read lessons, answering reschedules.
  const quiz = await api('GET', `/lessons/${lessonId}/quiz`);
  assert.equal(quiz.data.items.length, 1);
  const ans = await api('POST', `/reviews/${quiz.data.items[0].id}`, { result: 'remembered' });
  assert.ok(ans.data.nextDue > new Date().toISOString());

  // Companion: commands work without the model, questions go to the tutor with context.
  const where = await api('POST', `/journeys/${id}/companion`, { text: 'where are we?' });
  assert.equal(where.data.action, 'where');
  const note = await api('POST', `/journeys/${id}/companion`, { text: 'save note: kalam = rational theology' });
  assert.equal(note.data.action, 'note_saved');
  const ask = await api('POST', `/journeys/${id}/companion`, { text: 'Explain the key idea', lessonId });
  assert.match(ask.data.reply, /Tutor reply/);

  // Natural-language plan change.
  const ch = await api('POST', `/journeys/${id}/change`, { request: 'make it 5 minutes a day' });
  assert.equal(ch.data.applied, true);

  // Knowledge base search + progress + synthesis.
  const s = await api('GET', `/search?q=reason&journeyId=${id}`);
  assert.ok(s.data.lessons.length + s.data.notes.length > 0);
  const prog = await api('GET', `/journeys/${id}/progress`);
  assert.equal(prog.data.read, 1);
  assert.equal((await api('POST', `/journeys/${id}/synthesis`)).data.overview, 'o');
  const map = await api('GET', `/journeys/${id}/map`);
  assert.equal(map.data.nodes.length, 2);
  assert.equal(map.data.relations.length, 1, 'relation to an unknown node was dropped');

  // Privacy: another user cannot see this journey or lesson.
  const other = client();
  await other('POST', '/auth/guest', {});
  assert.equal((await other('GET', `/journeys/${id}`)).status, 404);
  assert.equal((await other('GET', `/lessons/${lessonId}`)).status, 404);
  assert.equal((await other('PUT', '/prefs', { detail: 'nonsense' })).status, 400);

  // Account upgrade keeps data; export; delete.
  assert.equal((await api('POST', '/auth/register', { email: 'learner@example.com', password: 'longpassword' })).status, 200);
  const me2 = await api('GET', '/me');
  assert.equal(me2.data.user.is_guest, 0);
  assert.equal(me2.data.journeys.length, 1);
  const exp = await api('GET', '/me/export');
  assert.equal(exp.data.journeys.length, 1);
  assert.ok(exp.data.notes.length >= 2);
  assert.equal((await api('DELETE', '/me')).status, 200);
  const relog = client();
  assert.equal((await relog('POST', '/auth/login', { email: 'learner@example.com', password: 'longpassword' })).status, 401);
  assert.ok(calls.includes('web:research') && calls.includes('json:synthesis'));
});
