import { q } from '../db.ts';
import { newId, nowIso } from '../util.ts';
import type { FoundSource } from '../ai/research.ts';
import { verifySource } from '../ai/verify.ts';

export type SourceRow = {
  id: string;
  journey_id: string;
  kind: string;
  title: string;
  authors: string | null;
  year: string | null;
  publisher: string | null;
  doi: string | null;
  url: string | null;
  language: string | null;
  is_primary: number;
  origin: string;
  verification_status: string;
  verification_note: string | null;
  accessed_at: string;
};

/**
 * Store found sources for a journey (deduplicated by URL), run verification
 * on new ones, and attach their verbatim excerpts. Returns stored rows in input order.
 */
export async function storeSources(journeyId: string, found: FoundSource[]): Promise<SourceRow[]> {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const fresh = found.filter((f) => {
    if (!f.url || seen.has(f.url)) return false;
    seen.add(f.url);
    return true;
  });
  const checks = await Promise.all(
    fresh.map(async (f) => {
      const existing = q.get<SourceRow>('SELECT * FROM sources WHERE journey_id=? AND url=?', journeyId, f.url);
      if (existing) return { f, existing, v: null };
      return { f, existing: null, v: await verifySource(f) };
    }),
  );
  for (const { f, existing, v } of checks) {
    let row = existing;
    if (!row && v) {
      const s = { ...f, ...v.patch };
      const id = newId('s_');
      q.run(
        `INSERT INTO sources(id,journey_id,kind,title,authors,year,publisher,doi,url,language,is_primary,origin,verification_status,verification_note,accessed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, journeyId, s.kind, s.title.slice(0, 500), s.authors ?? null, s.year ?? null, s.publisher ?? null, s.doi ?? null, s.url, s.language ?? null, s.isPrimary ? 1 : 0, s.origin, v.status, [v.note, f.note].filter(Boolean).join('; '), nowIso(),
      );
      row = q.get<SourceRow>('SELECT * FROM sources WHERE id=?', id)!;
    }
    if (!row) continue;
    for (const e of f.excerpts) {
      const dup = q.get('SELECT id FROM excerpts WHERE source_id=? AND text=?', row.id, e.text);
      if (!dup) q.run('INSERT INTO excerpts(id,source_id,text,origin) VALUES (?,?,?,?)', newId('e_'), row.id, e.text.slice(0, 4000), e.origin);
    }
    out.push(row);
  }
  return out;
}

export function sourcesForLesson(lessonId: string) {
  return q.all<SourceRow>(
    'SELECT DISTINCT s.* FROM sources s JOIN source_refs r ON r.source_id=s.id WHERE r.lesson_id=? ORDER BY s.is_primary DESC, s.year',
    lessonId,
  );
}
