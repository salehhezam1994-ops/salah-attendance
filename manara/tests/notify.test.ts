import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Scheduler + push delivery with a fake transport (no real push service is contacted). */
process.env.MANARA_DB_FILE = ':memory:';
process.env.SOURCE_TIMEOUT_MS = '200';
process.env.DATA_DIR = (await import('node:os')).tmpdir() + '/manara-notify-test';

const { setLlm } = await import('../server/ai/llm.ts');
const { DemoLLM } = await import('../server/ai/demo.ts');
const { createApp } = await import('../server/index.ts');
const { waitAll } = await import('../server/services/jobs.ts');
const { setTransport } = await import('../server/services/push.ts');
const { runNotifierTick, inQuiet, localParts } = await import('../server/services/notifier.ts');
const { q } = await import('../server/db.ts');

setLlm(new DemoLLM());
const sent: { kind: string; endpoint: string; title: string; body: string; url: string }[] = [];
let gone = new Set<string>();
setTransport({
  async webpush(s, m) {
    if (gone.has(s.endpoint)) return 'gone';
    sent.push({ kind: 'webpush', endpoint: s.endpoint, ...m });
    return 'ok';
  },
  async fcm(s, m) {
    sent.push({ kind: 'fcm', endpoint: s.endpoint, ...m });
    return 'ok';
  },
});

const app = createApp();
let cookie = '';
async function api(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, data: (await res.json().catch(() => null)) as any };
}

test('time helpers', () => {
  assert.equal(inQuiet(23 * 60, '22:00', '07:00'), true);
  assert.equal(inQuiet(6 * 60 + 59, '22:00', '07:00'), true);
  assert.equal(inQuiet(8 * 60, '22:00', '07:00'), false);
  assert.equal(inQuiet(13 * 60, '12:00', '14:00'), true);
  const p = localParts(new Date('2026-03-10T05:30:00Z'), 'Asia/Riyadh'); // UTC+3
  assert.deepEqual(p, { date: '2026-03-10', minutes: 8 * 60 + 30 });
});

test('push: subscription, daily reminder in local time, quiet hours, one per day, comeback', async () => {
  await api('POST', '/auth/guest', { locale: 'ar' });
  // Journey via the interview (demo provider builds the plan).
  const j = (await api('POST', '/journeys', {})).data.id;
  const answers: [string, string?][] = [['الاقتصاد الإسلامي'], ['', 'curiosity'], ['', 'basic'], ['', 'general'], ['فهم الأسس'], ['', 'balanced'], ['10 دقائق'], ['', '4'], ['', 'brief'], ['', 'both'], ['', 'no'], ['', 'read']];
  for (const [text, choice] of answers) await api('POST', `/journeys/${j}/interview/answer`, { text, choice });
  await api('POST', `/journeys/${j}/goal`, { accept: true });
  await waitAll();
  await api('POST', `/journeys/${j}/approve`);
  await waitAll();

  // Invalid inputs are rejected.
  assert.equal((await api('PUT', '/prefs', { timezone: 'Mars/Olympus' })).status, 400);
  assert.equal((await api('POST', '/push/subscribe', { kind: 'webpush', subscription: { endpoint: 'http://insecure.example/x', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);

  const cfg = await api('GET', '/push/config');
  assert.ok(cfg.data.webPushPublicKey.length > 40, 'VAPID public key is served');
  assert.equal((await api('POST', '/push/subscribe', { kind: 'webpush', subscription: { endpoint: 'https://push.example/dev1', keys: { p256dh: 'p', auth: 'a' } } })).data.devices, 1);
  assert.equal((await api('POST', '/push/subscribe', { kind: 'fcm', token: 'fcm-token-'.padEnd(40, 'x'), platform: 'android' })).data.devices, 2);

  // Notifications disabled -> nothing is sent.
  await api('PUT', '/prefs', { timezone: 'Asia/Riyadh', notify: { enabled: false, dailyTime: '08:00', reviews: true, comeback: true, updates: true, quietStart: '22:00', quietEnd: '07:00' } });
  await runNotifierTick(new Date('2030-01-01T06:00:00Z'));
  assert.equal(sent.length, 0);

  await api('PUT', '/prefs', { notify: { enabled: true, dailyTime: '08:00', reviews: true, comeback: true, updates: true, quietStart: '22:00', quietEnd: '07:00' } });
  q.run('UPDATE journeys SET last_active_at=?', '2030-01-01T00:00:00.000Z');
  // 07:30 Riyadh: before the chosen time.
  await runNotifierTick(new Date('2030-01-01T04:30:00Z'));
  assert.equal(sent.length, 0);
  // 08:05 Riyadh: today's dose goes to both devices.
  await runNotifierTick(new Date('2030-01-01T05:05:00Z'));
  assert.equal(sent.length, 2);
  assert.match(sent[0].title, /جرعتك/);
  assert.match(sent[0].url, new RegExp(`/j/${j}/lesson/`));
  // Same day again -> no duplicate.
  await runNotifierTick(new Date('2030-01-01T10:00:00Z'));
  assert.equal(sent.length, 2);

  // Quiet hours (23:00 Riyadh on the next day) -> nothing even though it is after 08:00.
  q.run('UPDATE journeys SET last_active_at=?', '2030-01-02T00:00:00.000Z');
  await runNotifierTick(new Date('2030-01-02T20:00:00Z'));
  assert.equal(sent.length, 2);

  // A dead Web Push subscription is removed on delivery.
  gone = new Set(['https://push.example/dev1']);
  await runNotifierTick(new Date('2030-01-03T06:00:00Z'));
  q.run('UPDATE journeys SET last_active_at=?', '2030-01-03T00:00:00.000Z');
  assert.equal((await api('GET', '/push/config')).data.devices, 1);

  // Away 3 days -> one gentle "welcome back", no daily nagging; day 5 -> silence.
  const before = sent.length;
  q.run('UPDATE journeys SET last_active_at=?', '2030-01-10T03:00:00.000Z');
  await runNotifierTick(new Date('2030-01-13T06:00:00Z'));
  assert.equal(sent.length, before + 1);
  assert.match(sent[sent.length - 1].title, /بعودتك/);
  await runNotifierTick(new Date('2030-01-15T06:00:00Z'));
  assert.equal(sent.length, before + 1);

  // Test endpoint + in-app history.
  const t = await api('POST', '/push/test');
  assert.equal(t.data.delivered, 1);
  const hist = await api('GET', '/notifications');
  assert.ok(hist.data.items.length >= 3);

  // Unsubscribe.
  await api('POST', '/push/unsubscribe', { endpoint: 'fcm-token-'.padEnd(40, 'x') });
  assert.equal((await api('GET', '/push/config')).data.devices, 0);
});

test('real Web Push request: VAPID-signed, encrypted (aes128gcm), gone endpoints removed', async () => {
  const https = await import('node:https');
  const crypto = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const { saveSubscription, sendToUser, setWebPushAgent } = await import('../server/services/push.ts');
  // Local HTTPS "push service" with a throwaway self-signed certificate, trusted only by this agent.
  const dir = fs.mkdtempSync((await import('node:os')).tmpdir() + '/manara-push-');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const cert = fs.readFileSync(`${dir}/c.pem`);
  setWebPushAgent(new https.Agent({ ca: cert }));
  setTransport(null); // use the real web-push implementation
  const seen: { headers: Record<string, string | string[] | undefined>; bytes: number; path: string }[] = [];
  const server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ headers: req.headers, bytes: Buffer.concat(chunks).length, path: req.url ?? '' });
      res.statusCode = req.url === '/gone' ? 410 : 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  const uid = q.get<{ id: string }>('SELECT id FROM users LIMIT 1')!.id;
  q.run('DELETE FROM push_subscriptions');
  saveSubscription(uid, { kind: 'webpush', endpoint: `https://127.0.0.1:${port}/ok`, keys, platform: 'web' });
  saveSubscription(uid, { kind: 'webpush', endpoint: `https://127.0.0.1:${port}/gone`, keys, platform: 'web' });
  const r = await sendToUser(uid, { title: 'منارة', body: 'اختبار', url: '/', tag: 'test' });
  server.close();
  assert.equal(r.delivered, 1);
  const ok = seen.find((s) => s.path === '/ok')!;
  assert.equal(ok.headers['content-encoding'], 'aes128gcm');
  assert.match(String(ok.headers.authorization), /^vapid t=.+, k=.+/);
  assert.ok(ok.bytes > 0 && ok.bytes < 4096);
  assert.equal(q.get<{ n: number }>('SELECT COUNT(*) n FROM push_subscriptions')!.n, 1, '410 subscription deleted');
});
