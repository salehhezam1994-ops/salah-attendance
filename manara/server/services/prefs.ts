import { z } from 'zod';
import { q } from '../db.ts';
import { nowIso, parseJson } from '../util.ts';

export const PrefsSchema = z.object({
  locale: z.enum(['ar', 'en']),
  detail: z.enum(['brief', 'medium', 'detailed']),
  documentation: z.enum(['standard', 'strict']), // strict: hide unsupported paragraphs entirely
  voice: z.object({ rate: z.number().min(0.5).max(2), autoRead: z.boolean(), voiceName: z.string().nullable() }),
  notify: z.object({ enabled: z.boolean(), dailyTime: z.string().regex(/^\d{2}:\d{2}$/), reviews: z.boolean(), comeback: z.boolean(), updates: z.boolean() }),
  savedCommands: z.array(z.string().max(200)).max(30),
  advanced: z.boolean(), // show the advanced management mode
  interests: z.array(z.string().max(120)).max(30),
  avoid: z.array(z.string().max(120)).max(30),
  preferredSources: z.array(z.string().max(160)).max(30),
  theme: z.enum(['system', 'light', 'dark']),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const defaultPrefs = (locale: 'ar' | 'en' = 'ar'): Prefs => ({
  locale,
  detail: 'medium',
  documentation: 'standard',
  voice: { rate: 1, autoRead: false, voiceName: null },
  notify: { enabled: false, dailyTime: '08:00', reviews: true, comeback: true, updates: true },
  savedCommands: [],
  advanced: false,
  interests: [],
  avoid: [],
  preferredSources: [],
  theme: 'system',
});

export function getPrefs(userId: string): Prefs {
  const row = q.get<{ data: string }>('SELECT data FROM preferences WHERE user_id=?', userId);
  const base = defaultPrefs();
  const stored = parseJson<Partial<Prefs>>(row?.data, {});
  return { ...base, ...stored, voice: { ...base.voice, ...(stored.voice ?? {}) }, notify: { ...base.notify, ...(stored.notify ?? {}) } };
}

export function savePrefs(userId: string, patch: Partial<Prefs>): Prefs {
  const merged = PrefsSchema.parse({ ...getPrefs(userId), ...patch, ...(patch.voice ? { voice: { ...getPrefs(userId).voice, ...patch.voice } } : {}), ...(patch.notify ? { notify: { ...getPrefs(userId).notify, ...patch.notify } } : {}) });
  q.run(
    'INSERT INTO preferences(user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    userId, JSON.stringify(merged), nowIso(),
  );
  return merged;
}
