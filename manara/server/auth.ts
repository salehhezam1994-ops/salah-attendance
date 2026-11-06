import crypto from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { q } from './db.ts';
import { config } from './config.ts';
import { HttpError, addDays, newId, nowIso } from './util.ts';
import { ensureSubscription } from './limits.ts';

const COOKIE = 'manara_session';

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [, saltB64, hashB64] = stored.split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(c: Context, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', sha(token), userId, addDays(new Date(), config.sessionDays).toISOString());
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.production,
    path: '/',
    maxAge: config.sessionDays * 86400,
  });
}

export function destroySession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) q.run('DELETE FROM sessions WHERE token_hash=?', sha(token));
  deleteCookie(c, COOKIE, { path: '/' });
}

export function createUser(opts: { email?: string; name?: string; password?: string }) {
  const id = newId('u_');
  q.run(
    'INSERT INTO users(id,email,name,password_hash,is_guest,created_at) VALUES (?,?,?,?,?,?)',
    id,
    opts.email?.toLowerCase() ?? null,
    opts.name ?? null,
    opts.password ? hashPassword(opts.password) : null,
    opts.email ? 0 : 1,
    nowIso(),
  );
  ensureSubscription(id);
  return id;
}

export type AuthUser = { id: string; email: string | null; name: string | null; is_guest: number };
export type AppEnv = { Variables: { user: AuthUser } };

export async function requireUser(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, 'unauthenticated');
  const row = q.get<AuthUser & { expires_at: string }>(
    `SELECT u.id,u.email,u.name,u.is_guest,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`,
    sha(token),
  );
  if (!row || row.expires_at < nowIso()) throw new HttpError(401, 'unauthenticated');
  c.set('user', { id: row.id, email: row.email, name: row.name, is_guest: row.is_guest });
  await next();
}

export function isAdmin(u: AuthUser) {
  return !!u.email && config.adminEmails.includes(u.email.toLowerCase());
}
