import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { config, type AiMode } from '../config.ts';
import { HttpError, safeLog } from '../util.ts';
import { DemoLLM } from './demo.ts';

/**
 * Narrow interface every agent uses. Agents never talk to the SDK directly,
 * so the provider can be swapped (or faked in tests).
 *
 * tier "strong" = planning, scientific synthesis, plan edits (complex analysis)
 * tier "fast"   = interview phrasing, extraction, review questions, short chat
 */
export type Tier = 'strong' | 'fast';
export type ChatMsg = { role: 'user' | 'assistant'; content: string };

export type SearchCitation = { url: string; title: string | null; citedText: string };
export type SearchResult = { url: string; title: string; pageAge: string | null };
export type WebResearch = { text: string; citations: SearchCitation[]; results: SearchResult[] };

export interface LLM {
  mode: AiMode;
  json<S extends z.ZodType>(o: { task: string; tier: Tier; system: string; prompt: string; schema: S; effort?: 'low' | 'medium' | 'high' }): Promise<z.infer<S>>;
  chat(o: { task: string; tier: Tier; system: string; messages: ChatMsg[] }): Promise<string>;
  /** Live web research. Returns only what the search API actually returned. */
  webResearch(o: { task: string; system: string; prompt: string; maxSearches: number; allowedDomains?: string[] }): Promise<WebResearch>;
}

class AnthropicLLM implements LLM {
  mode: AiMode = 'anthropic';
  private client = new Anthropic();

  private model(tier: Tier) {
    return tier === 'strong' ? config.modelStrong : config.modelFast;
  }

  /** Server-side refusal fallback is supported on the Opus/Fable/Sonnet 5.x line. */
  private fallbackOpts(model: string) {
    return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model)
      ? { betas: ['server-side-fallback-2026-07-01'] as string[], fallbacks: 'default' as const }
      : { betas: [] as string[] };
  }

  private wrap(task: string, e: unknown): never {
    safeLog(`llm:${task}`, e);
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'ai_busy');
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'ai_misconfigured');
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(503, 'ai_unreachable');
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'ai_failed');
  }

  async json<S extends z.ZodType>(o: { task: string; tier: Tier; system: string; prompt: string; schema: S; effort?: 'low' | 'medium' | 'high' }): Promise<z.infer<S>> {
    const model = this.model(o.tier);
    try {
      const res = await this.client.beta.messages.parse({
        model,
        max_tokens: 16000,
        system: o.system,
        messages: [{ role: 'user', content: o.prompt }],
        output_config: { format: betaZodOutputFormat(o.schema), effort: o.effort ?? (o.tier === 'strong' ? 'high' : 'low') },
        ...this.fallbackOpts(model),
      });
      if (res.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused');
      if (res.parsed_output == null) throw new HttpError(502, 'ai_bad_output');
      return res.parsed_output as z.infer<S>;
    } catch (e) {
      this.wrap(o.task, e);
    }
  }

  async chat(o: { task: string; tier: Tier; system: string; messages: ChatMsg[] }): Promise<string> {
    const model = this.model(o.tier);
    try {
      const res = await this.client.beta.messages.create({
        model,
        max_tokens: 4000,
        system: o.system,
        messages: o.messages,
        output_config: { effort: o.tier === 'strong' ? 'medium' : 'low' },
        ...this.fallbackOpts(model),
      });
      if (res.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused');
      return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    } catch (e) {
      this.wrap(o.task, e);
    }
  }

  async webResearch(o: { task: string; system: string; prompt: string; maxSearches: number; allowedDomains?: string[] }): Promise<WebResearch> {
    const model = config.modelStrong;
    try {
      let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: o.prompt }];
      const out: WebResearch = { text: '', citations: [], results: [] };
      // pause_turn: a long server-tool turn may pause; send it back to continue (max 3 resumes).
      for (let i = 0; i < 4; i++) {
        const res = await this.client.beta.messages.create({
          model,
          max_tokens: 16000,
          system: o.system,
          messages,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: o.maxSearches, ...(o.allowedDomains?.length ? { allowed_domains: o.allowedDomains } : {}) }],
          output_config: { effort: 'medium' },
          ...this.fallbackOpts(model),
        });
        for (const b of res.content) {
          if (b.type === 'text') {
            out.text += b.text;
            for (const c of b.citations ?? []) {
              if (c.type === 'web_search_result_location') out.citations.push({ url: c.url, title: c.title, citedText: c.cited_text });
            }
          } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
            for (const r of b.content) out.results.push({ url: r.url, title: r.title, pageAge: r.page_age });
          }
        }
        if (res.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused');
        if (res.stop_reason !== 'pause_turn') break;
        messages = [...messages, { role: 'assistant', content: res.content }];
      }
      return out;
    } catch (e) {
      this.wrap(o.task, e);
    }
  }
}

class UnavailableLLM implements LLM {
  constructor(public mode: AiMode) {}
  private fail(): never {
    throw new HttpError(503, 'ai_not_configured');
  }
  async json(): Promise<never> {
    this.fail();
  }
  async chat(): Promise<never> {
    this.fail();
  }
  async webResearch(): Promise<never> {
    this.fail();
  }
}

let _llm: LLM | null = null;
export function llm(): LLM {
  if (!_llm) _llm = config.aiMode === 'anthropic' ? new AnthropicLLM() : config.aiMode === 'demo' ? new DemoLLM() : new UnavailableLLM(config.aiMode);
  return _llm;
}
/** Tests inject a fake provider here. */
export function setLlm(l: LLM | null) {
  _llm = l;
}
export const aiMode = (): AiMode => llm().mode;
