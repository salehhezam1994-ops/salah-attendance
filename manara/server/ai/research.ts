import { config } from '../config.ts';
import { normalizeText, safeLog } from '../util.ts';
import type { LLM } from './llm.ts';

/**
 * Research Agent + source adapters.
 *
 * Anti-fabrication rule: a source enters the system ONLY if its URL/identifier
 * came back from a real search API (Claude web search results, OpenAlex,
 * Crossref, Wikipedia, Open Library). The model may describe and classify a
 * source, but it can never introduce one. Excerpts are verbatim text returned
 * by those APIs (web-search citations' cited_text, abstracts, encyclopedia
 * extracts) — they are the only text that may be quoted.
 */
export type SourceKind = 'book' | 'article' | 'paper' | 'thesis' | 'reference' | 'encyclopedia' | 'web' | 'primary' | 'official' | 'dataset';
export type FoundSource = {
  url: string;
  title: string;
  kind: SourceKind;
  authors?: string;
  year?: string;
  publisher?: string;
  doi?: string;
  language?: string;
  isPrimary?: boolean;
  origin: 'web_search' | 'openalex' | 'crossref' | 'wikipedia' | 'openlibrary';
  verified: boolean; // metadata came from an authoritative registry
  note?: string;
  excerpts: { text: string; origin: 'search_citation' | 'abstract' | 'summary' }[];
};

async function fetchJson(url: string): Promise<unknown | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), config.sourceTimeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': config.contactUserAgent, Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const DOI_RE = /10\.\d{4,9}\/[^\s"<>?#]+/i;
export const extractDoi = (s: string) => s.match(DOI_RE)?.[0]?.replace(/[.,;)]+$/, '');

function invertedToText(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const words: string[] = [];
  for (const [w, idxs] of Object.entries(inv)) for (const i of idxs) words[i] = w;
  return words.filter(Boolean).join(' ');
}

/** OpenAlex: peer-reviewed works, books, theses with abstracts. Free, no key. */
export async function searchOpenAlex(query: string, opts: { perPage?: number; sinceYear?: number } = {}): Promise<FoundSource[]> {
  const filter = opts.sinceYear ? `&filter=from_publication_date:${opts.sinceYear}-01-01` : '';
  const data = (await fetchJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${opts.perPage ?? 6}${filter}`)) as { results?: Record<string, any>[] } | null;
  if (!data?.results) return [];
  return data.results
    .filter((w) => w.title)
    .map((w) => {
      const type = String(w.type || '');
      const kind: SourceKind = type.includes('book') ? 'book' : type === 'dissertation' ? 'thesis' : type === 'article' ? 'paper' : 'article';
      const abstract = invertedToText(w.abstract_inverted_index);
      return {
        url: w.doi || w.primary_location?.landing_page_url || w.id,
        title: w.title,
        kind,
        authors: (w.authorships || []).slice(0, 4).map((a: any) => a.author?.display_name).filter(Boolean).join('، '),
        year: w.publication_year ? String(w.publication_year) : undefined,
        publisher: w.primary_location?.source?.display_name || undefined,
        doi: w.doi ? String(w.doi).replace('https://doi.org/', '') : undefined,
        language: w.language || undefined,
        origin: 'openalex' as const,
        verified: true,
        excerpts: abstract ? [{ text: abstract.slice(0, 1800), origin: 'abstract' as const }] : [],
      };
    });
}

/** Wikipedia (as a tertiary orientation source, clearly labelled encyclopedia). */
export async function searchWikipedia(query: string, lang: string): Promise<FoundSource[]> {
  const base = `https://${lang === 'ar' ? 'ar' : 'en'}.wikipedia.org`;
  const s = (await fetchJson(`${base}/w/api.php?action=query&list=search&format=json&srlimit=2&srsearch=${encodeURIComponent(query)}`)) as { query?: { search?: { title: string }[] } } | null;
  const titles = s?.query?.search?.map((x) => x.title) ?? [];
  const out: FoundSource[] = [];
  for (const title of titles) {
    const sum = (await fetchJson(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`)) as { extract?: string; content_urls?: { desktop?: { page?: string } }; title?: string } | null;
    if (!sum?.extract) continue;
    out.push({
      url: sum.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(title)}`,
      title: sum.title || title,
      kind: 'encyclopedia',
      publisher: 'Wikipedia',
      language: lang,
      origin: 'wikipedia',
      verified: true,
      note: 'tertiary',
      excerpts: [{ text: sum.extract, origin: 'summary' }],
    });
  }
  return out;
}

/** Open Library: book metadata (editions, authors, years). */
export async function searchOpenLibrary(query: string): Promise<FoundSource[]> {
  const d = (await fetchJson(`https://openlibrary.org/search.json?limit=4&q=${encodeURIComponent(query)}`)) as { docs?: Record<string, any>[] } | null;
  return (d?.docs ?? []).filter((b) => b.title && b.key).map((b) => ({
    url: `https://openlibrary.org${b.key}`,
    title: b.title,
    kind: 'book' as const,
    authors: (b.author_name || []).slice(0, 3).join('، '),
    year: b.first_publish_year ? String(b.first_publish_year) : undefined,
    publisher: (b.publisher || [])[0],
    origin: 'openlibrary' as const,
    verified: true,
    excerpts: [],
  }));
}

/** Crossref DOI check: confirms a DOI resolves and returns registry metadata. */
export async function crossrefLookup(doi: string): Promise<{ title: string; year?: string; publisher?: string; authors?: string } | null> {
  const d = (await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)) as { message?: Record<string, any> } | null;
  const m = d?.message;
  if (!m?.title?.[0]) return null;
  return {
    title: m.title[0],
    year: m.issued?.['date-parts']?.[0]?.[0] ? String(m.issued['date-parts'][0][0]) : undefined,
    publisher: m['container-title']?.[0] || m.publisher,
    authors: (m.author || []).slice(0, 4).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).join('، '),
  };
}

const RESEARCH_SYSTEM = `You are the Research Agent of "Manara", a scholarly learning companion.
Use web search to find RELIABLE sources: original/founding works, reference books, peer-reviewed papers, theses, official or primary documents, reputable encyclopedias and university pages. Avoid content farms, anonymous blogs and AI-generated pages.
Then write concise research notes in which EVERY factual statement is grounded in the search results (your citations are recorded automatically). Report disagreements between scholars when you see them. Say clearly when evidence is thin.
Finish with a line "SOURCES_JSON:" followed by a JSON array, one object per source you actually used, with keys:
 url (exactly as in the search results), kind (book|article|paper|thesis|reference|encyclopedia|web|primary|official|dataset), authors (or ""), year (or ""), publisher (or ""), is_primary (true if it is an original/founding text or primary document).
Only describe metadata visible in the results; use "" when unknown. Never add a source that did not appear in the search results.`;

export function parseSourcesJson(text: string): Record<string, any>[] {
  const i = text.lastIndexOf('SOURCES_JSON:');
  if (i < 0) return [];
  const rest = text.slice(i + 'SOURCES_JSON:'.length);
  const start = rest.indexOf('[');
  const end = rest.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const arr = JSON.parse(rest.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const canonicalUrl = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '').replace(/^http:/, 'https:');

/**
 * Web research through Claude's server-side web search. Sources are built from
 * the search RESULTS list; model metadata is attached only to URLs that are in it.
 */
export async function webResearch(ai: LLM, o: { topic: string; focus: string; lang: string; goal: string; level: string; sourcePref: string; maxSearches?: number }): Promise<{ notes: string; sources: FoundSource[] }> {
  const prompt = `Learner goal: ${o.goal}
Level: ${o.level}. Source preference: ${o.sourcePref}. Preferred language of sources: ${o.lang === 'ar' ? 'Arabic first, plus key English scholarship' : 'English first, plus key scholarship in original languages'}.
Research this specific topic for today's study unit: "${o.topic}"
Focus: ${o.focus}
Find 4-8 strong sources (include at least one original/founding or reference work when the field has them) and write research notes (in ${o.lang === 'ar' ? 'Arabic' : 'English'}) covering: core idea, key concepts, historical/intellectual background, main positions and evidence, open questions.`;
  const r = await ai.webResearch({ task: 'research', system: RESEARCH_SYSTEM, prompt, maxSearches: o.maxSearches ?? 5 });
  const resultByUrl = new Map<string, { title: string; pageAge: string | null }>();
  for (const x of r.results) resultByUrl.set(canonicalUrl(x.url), { title: x.title, pageAge: x.pageAge });
  for (const c of r.citations) if (!resultByUrl.has(canonicalUrl(c.url))) resultByUrl.set(canonicalUrl(c.url), { title: c.title || c.url, pageAge: null });

  const meta = new Map<string, Record<string, any>>();
  for (const m of parseSourcesJson(r.text)) if (typeof m.url === 'string') meta.set(canonicalUrl(m.url), m);

  const byUrl = new Map<string, FoundSource>();
  // Keep sources that were cited (grounded) first, then ones the model listed from results.
  const used = new Set<string>([...r.citations.map((c) => canonicalUrl(c.url)), ...[...meta.keys()].filter((u) => resultByUrl.has(u))]);
  for (const u of used) {
    const res = resultByUrl.get(u);
    if (!res) continue; // not in real search results -> rejected
    const m = meta.get(u) ?? {};
    const kinds: SourceKind[] = ['book', 'article', 'paper', 'thesis', 'reference', 'encyclopedia', 'web', 'primary', 'official', 'dataset'];
    byUrl.set(u, {
      url: u,
      title: res.title,
      kind: kinds.includes(m.kind) ? m.kind : 'web',
      authors: m.authors || undefined,
      year: m.year ? String(m.year) : undefined,
      publisher: m.publisher || undefined,
      doi: extractDoi(u),
      isPrimary: !!m.is_primary,
      origin: 'web_search',
      verified: false,
      note: res.pageAge ? `page_age:${res.pageAge}` : undefined,
      excerpts: [],
    });
  }
  for (const c of r.citations) {
    const s = byUrl.get(canonicalUrl(c.url));
    if (s && c.citedText.trim() && !s.excerpts.some((e) => e.text === c.citedText)) s.excerpts.push({ text: c.citedText.trim(), origin: 'search_citation' });
  }
  const notes = r.text.split('SOURCES_JSON:')[0].trim();
  return { notes, sources: [...byUrl.values()] };
}

/** Scholarly-database pass (works where the network allows these APIs). */
export async function databaseResearch(query: string, lang: string, sourcePref: string): Promise<FoundSource[]> {
  const tasks: Promise<FoundSource[]>[] = [searchOpenAlex(query, { perPage: 4 }), searchWikipedia(query, lang)];
  if (sourcePref !== 'modern') tasks.push(searchOpenLibrary(query));
  const settled = await Promise.allSettled(tasks);
  const out: FoundSource[] = [];
  for (const s of settled) if (s.status === 'fulfilled') out.push(...s.value);
    else safeLog('databaseResearch', s.reason);
  return out;
}

/** Light relevance filter so database hits don't drift off-topic. */
export function relevant(s: FoundSource, terms: string[]) {
  const hay = normalizeText(`${s.title} ${s.excerpts.map((e) => e.text).join(' ')}`);
  return terms.some((t) => t.length > 2 && hay.includes(normalizeText(t)));
}
