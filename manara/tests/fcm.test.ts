import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/**
 * FCM HTTP v1 path: OAuth JWT signed with the service-account key, message shape,
 * token caching and removal of unregistered devices. fetch is intercepted, so no
 * Google endpoint is contacted.
 */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.MANARA_DB_FILE = ':memory:';
process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'manara-test',
  client_email: 'push@manara-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: 'https://oauth2.googleapis.com/token',
});

const { fcmEnabled, saveSubscription, sendToUser } = await import('../server/services/push.ts');
const { createUser } = await import('../server/auth.ts');
const { q } = await import('../server/db.ts');

test('FCM: signed JWT, message shape, token cache, unregistered tokens removed', async () => {
  assert.equal(fcmEnabled(), true);
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    const body = JSON.parse(String(init.body));
    if (body.message.token.startsWith('dead')) return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const uid = createUser({});
    saveSubscription(uid, { kind: 'fcm', endpoint: 'live-token-'.padEnd(40, 'x'), platform: 'android' });
    saveSubscription(uid, { kind: 'fcm', endpoint: 'dead-token-'.padEnd(40, 'x'), platform: 'android' });
    const r = await sendToUser(uid, { title: 'جرعتك', body: 'نص', url: '/j/x/lesson/y', tag: 'daily:x' });
    assert.deepEqual(r, { delivered: 1, devices: 2 });

    const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
    assert.equal(tokenCalls.length, 1, 'access token fetched once and cached');
    const assertion = new URLSearchParams(String(tokenCalls[0].init.body)).get('assertion')!;
    const [h, p, sig] = assertion.split('.');
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url')), 'JWT signature valid');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(claims.iss, 'push@manara-test.iam.gserviceaccount.com');

    const send = calls.find((c) => c.url.includes('fcm.googleapis.com') && String(c.init.body).includes('live-token'))!;
    assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/manara-test/messages:send');
    assert.equal((send.init.headers as Record<string, string>).authorization, 'Bearer ya29.test');
    const msg = JSON.parse(String(send.init.body)).message;
    assert.deepEqual(msg.data, { url: '/j/x/lesson/y', tag: 'daily:x' });
    assert.equal(msg.android.notification.channel_id, 'manara_default');
    assert.equal(q.get<{ n: number }>('SELECT COUNT(*) n FROM push_subscriptions')!.n, 1, 'unregistered token removed');
  } finally {
    globalThis.fetch = realFetch;
  }
});
