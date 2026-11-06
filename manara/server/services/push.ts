import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from 'node:https';
import { generateVAPIDKeys, sendNotification, WebPushError } from 'web-push';
import { config } from '../config.ts';
import { q } from '../db.ts';
import { newId, nowIso, safeLog } from '../util.ts';

/**
 * Push delivery. Two channels behind one function:
 *  - Web Push (VAPID) for the browser / installed PWA
 *  - Firebase Cloud Messaging HTTP v1 for the native Android app
 * Dead subscriptions are removed automatically (410/404 or UNREGISTERED).
 */
export type PushMessage = { title: string; body: string; url: string; tag: string };
export type Subscription = { id: string; user_id: string; kind: 'webpush' | 'fcm'; endpoint: string; keys_json: string | null; platform: string | null };
type Result = 'ok' | 'gone' | 'error';
export type Transport = { webpush: (s: Subscription, m: PushMessage) => Promise<Result>; fcm: (s: Subscription, m: PushMessage) => Promise<Result> };

/* ------------------------------ VAPID keys ------------------------------ */
let vapid: { publicKey: string; privateKey: string } | null = null;
export function vapidKeys() {
  if (vapid) return vapid;
  if (config.vapidPublicKey && config.vapidPrivateKey) return (vapid = { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey });
  const file = path.join(config.dataDir, 'vapid.json');
  try {
    vapid = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    vapid = generateVAPIDKeys();
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(vapid), { mode: 0o600 });
    } catch (e) {
      safeLog('vapid persist', e); // keys still work for this process
    }
  }
  return vapid!;
}

// Outbound HTTPS agent: tests pin a local CA here; otherwise an HTTPS proxy from the environment is honoured.
let webPushAgent: Agent | undefined;
export function setWebPushAgent(a: Agent | undefined) {
  webPushAgent = a;
}
const outboundProxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;

async function sendWebPush(s: Subscription, m: PushMessage): Promise<Result> {
  const keys = JSON.parse(s.keys_json ?? '{}');
  const k = vapidKeys();
  try {
    await sendNotification({ endpoint: s.endpoint, keys }, JSON.stringify(m), {
      TTL: 6 * 3600,
      urgency: 'normal',
      topic: m.tag.slice(0, 32),
      vapidDetails: { subject: config.vapidSubject, publicKey: k.publicKey, privateKey: k.privateKey },
      timeout: 15000,
      ...(webPushAgent ? { agent: webPushAgent } : outboundProxy ? { proxy: outboundProxy } : {}),
    });
    return 'ok';
  } catch (e) {
    if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) return 'gone';
    safeLog('webpush', e);
    return 'error';
  }
}

/* ------------------------------ FCM HTTP v1 ------------------------------ */
type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };
let sa: ServiceAccount | null | undefined;
let accessToken: { token: string; exp: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  if (sa !== undefined) return sa;
  const raw = config.fcmServiceAccount.trim();
  try {
    sa = raw ? (JSON.parse(raw.startsWith('{') ? raw : fs.readFileSync(raw, 'utf8')) as ServiceAccount) : null;
  } catch (e) {
    safeLog('fcm service account', e);
    sa = null;
  }
  return sa;
}
export const fcmEnabled = () => !!serviceAccount();

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

async function fcmAccessToken(acc: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.exp > Date.now() + 60_000) return accessToken.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = acc.token_uri || 'https://oauth2.googleapis.com/token';
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: acc.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat: now, exp: now + 3600 }));
  const signature = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), acc.private_key));
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`fcm token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function sendFcm(s: Subscription, m: PushMessage): Promise<Result> {
  const acc = serviceAccount();
  if (!acc) return 'error';
  try {
    const token = await fcmAccessToken(acc);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: s.endpoint,
          notification: { title: m.title, body: m.body },
          data: { url: m.url, tag: m.tag },
          android: { collapse_key: m.tag, ttl: '21600s', notification: { tag: m.tag, channel_id: 'manara_default', icon: 'ic_stat_manara' } },
        },
      }),
    });
    if (res.ok) return 'ok';
    const body = await res.text();
    if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(body)) return 'gone';
    safeLog('fcm', new Error(`${res.status} ${body.slice(0, 200)}`));
    return 'error';
  } catch (e) {
    safeLog('fcm', e);
    return 'error';
  }
}

let transport: Transport = { webpush: sendWebPush, fcm: sendFcm };
/** Tests inject a fake transport. */
export function setTransport(t: Transport | null) {
  transport = t ?? { webpush: sendWebPush, fcm: sendFcm };
}

/* ------------------------------ Subscriptions ------------------------------ */
export function saveSubscription(userId: string, sub: { kind: 'webpush' | 'fcm'; endpoint: string; keys?: unknown; platform: string }) {
  // An endpoint belongs to one device; re-registering moves it to the current user.
  q.run(
    `INSERT INTO push_subscriptions(id,user_id,kind,endpoint,keys_json,platform,created_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, keys_json=excluded.keys_json, platform=excluded.platform, failures=0`,
    newId('ps_'), userId, sub.kind, sub.endpoint, sub.keys ? JSON.stringify(sub.keys) : null, sub.platform, nowIso(),
  );
}

export function removeSubscription(userId: string, endpoint: string) {
  q.run('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?', userId, endpoint);
}

export const subscriptionCount = (userId: string) => q.get<{ n: number }>('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?', userId)!.n;

/** Deliver to every device of the user; also records the message in the in-app notification list. */
export async function sendToUser(userId: string, m: PushMessage, journeyId: string | null = null) {
  const subs = q.all<Subscription>('SELECT id,user_id,kind,endpoint,keys_json,platform FROM push_subscriptions WHERE user_id=?', userId);
  let delivered = 0;
  for (const s of subs) {
    const r = await (s.kind === 'fcm' ? transport.fcm(s, m) : transport.webpush(s, m));
    if (r === 'ok') {
      delivered++;
      q.run('UPDATE push_subscriptions SET last_ok_at=?, failures=0 WHERE id=?', nowIso(), s.id);
    } else if (r === 'gone') q.run('DELETE FROM push_subscriptions WHERE id=?', s.id);
    else {
      q.run('UPDATE push_subscriptions SET failures=failures+1 WHERE id=?', s.id);
      q.run('DELETE FROM push_subscriptions WHERE id=? AND failures>=10', s.id);
    }
  }
  q.run(
    'INSERT INTO notifications(id,user_id,journey_id,kind,title,body,url,delivered,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    newId('nf_'), userId, journeyId, m.tag.split(':')[0], m.title, m.body, m.url, delivered, nowIso(),
  );
  return { delivered, devices: subs.length };
}
