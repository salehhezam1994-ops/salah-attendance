import { q } from '../db.ts';
import { nowIso, safeLog } from '../util.ts';

/** Tiny in-process job runner with de-duplication by key (enough for one server instance). */
const running = new Map<string, Promise<void>>();

export function runJob(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;
  const p = fn()
    .catch((e) => {
      safeLog(`job ${key}`, e);
      try {
        q.run('INSERT INTO error_log(at,context,message) VALUES (?,?,?)', nowIso(), key.replace(/:[^:]+$/, ''), e instanceof Error ? e.message.slice(0, 300) : 'error');
      } catch {
        /* ignore */
      }
    })
    .finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

export const isRunning = (key: string) => running.has(key);
export const waitAll = () => Promise.all([...running.values()]);
