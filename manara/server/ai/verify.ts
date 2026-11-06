import { normalizeText } from '../util.ts';
import { config } from '../config.ts';
import { crossrefLookup, type FoundSource } from './research.ts';

/** ---------------- Source Verification Module ---------------- */

export type VerificationStatus = 'verified' | 'located' | 'unverified' | 'failed';

function similarity(a: string, b: string) {
  const A = new Set(normalizeText(a).split(' ').filter((w) => w.length > 2));
  const B = new Set(normalizeText(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

async function reachable(url: string): Promise<boolean | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), config.sourceTimeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    if (r.status === 405 || r.status === 403) return null; // server refuses HEAD/bots: inconclusive
    return r.status < 400;
  } catch {
    return null; // network policy / timeout: inconclusive, not a failure of the source
  } finally {
    clearTimeout(t);
  }
}

/**
 * Decide how far we can vouch for each source. Never upgrades a source
 * without evidence; inconclusive checks keep the honest lower status.
 */
export async function verifySource(s: FoundSource): Promise<{ status: VerificationStatus; note: string; patch: Partial<FoundSource> }> {
  if (s.verified) return { status: 'verified', note: `registry:${s.origin}`, patch: {} };
  if (s.doi) {
    const cr = await crossrefLookup(s.doi);
    if (cr) {
      const ok = similarity(cr.title, s.title) >= 0.5;
      return {
        status: ok ? 'verified' : 'located',
        note: ok ? 'doi_confirmed:crossref' : 'doi_resolves_title_differs',
        patch: { year: s.year || cr.year, publisher: s.publisher || cr.publisher, authors: s.authors || cr.authors },
      };
    }
  }
  const reach = await reachable(s.url);
  if (reach === false) return { status: 'failed', note: 'url_unreachable', patch: {} };
  if (s.origin === 'web_search') return { status: 'located', note: reach ? 'search_result_url_reachable' : 'search_result', patch: {} };
  return { status: 'unverified', note: 'no_check_possible', patch: {} };
}

/** ---------------- Citation Module ---------------- */

export type ClaimType = 'fact' | 'inference' | 'opinion';
export type Paragraph = {
  text: string;
  type: ClaimType;
  certainty: 'high' | 'medium' | 'low';
  cites: string[]; // excerpt keys, e.g. "E3"
  quote: { text: string; cite: string } | null;
  holder?: string | null; // whose opinion/position this is
  unsupported?: boolean; // set by validation
};
export type ExcerptIndex = Map<string, { excerptId: string; sourceId: string; text: string }>;

export type CitationReport = {
  claims: number;
  supported: number; // claims with at least one valid citation
  unsupported: number; // facts / attributed opinions without a valid citation (flagged to the user)
  uncited: number; // labelled inferences / general orientation without citations
  droppedCitations: number;
  quotesKept: number;
  quotesRejected: number;
};

export const emptyReport = (): CitationReport => ({ claims: 0, supported: 0, unsupported: 0, uncited: 0, droppedCitations: 0, quotesKept: 0, quotesRejected: 0 });

/**
 * Enforce the scholarly-honesty rules on generated text:
 *  - citations must point to excerpts that really exist (others dropped)
 *  - a factual claim without a valid citation is flagged "unsupported" (shown to the user)
 *  - an attributed opinion without a citation is flagged too (no attributing views without evidence)
 *  - a direct quote is kept only if it appears verbatim in the cited excerpt
 */
export function validateParagraph(p: Paragraph, index: ExcerptIndex, report: CitationReport): Paragraph {
  const valid = p.cites.filter((c) => index.has(c));
  report.droppedCitations += p.cites.length - valid.length;
  let quote = p.quote;
  if (quote) {
    const ex = index.get(quote.cite);
    if (ex && quote.text.trim().length > 3 && normalizeText(ex.text).includes(normalizeText(quote.text))) {
      report.quotesKept++;
      if (!valid.includes(quote.cite)) valid.push(quote.cite);
    } else {
      report.quotesRejected++;
      quote = null;
    }
  }
  report.claims++;
  const needsCite = p.type === 'fact' || (p.type === 'opinion' && !!p.holder);
  const unsupported = needsCite && valid.length === 0;
  if (unsupported) report.unsupported++;
  else if (valid.length) report.supported++;
  else report.uncited++;
  return { ...p, cites: valid, quote, unsupported };
}
