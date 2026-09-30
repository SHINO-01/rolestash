import type { SelectorField } from '../adapters/types';
import { classifyEmploymentTypes, classifyWorkplace } from '../normalize/classifiers';
import { toIsoDate } from '../normalize/dates';
import { parseSalaryText } from '../normalize/salary';
import { cleanText, elementToText } from '../normalize/text';
import { tryParseUrl } from '../normalize/url';
import type { ExtractedFields, ExtractionContext, Strategy, StrategyOutput } from '../types';
import { defaultCurrencyFor, firstMatch, isMeaningful, put } from './shared';

/**
 * Runs the resolved site adapter: selectors, custom extract, title patterns
 * and URL-derived values, each with its own confidence.
 */

const DEFAULT_SELECTOR_CONFIDENCE = 0.85;
const CUSTOM_CONFIDENCE = 0.85;
const TITLE_PATTERN_CONFIDENCE = 0.7;
const URL_CONFIDENCE = 0.5;

/** Fields whose value is spread over several chips/pills. */
const MULTI_ELEMENT_FIELDS = new Set<SelectorField>(['employmentType', 'workplaceType', 'salary']);

function runSelectors(ctx: ExtractionContext, out: StrategyOutput): void {
  const adapter = ctx.adapter;
  if (!adapter?.selectors) return;
  const confidence = adapter.selectorConfidence ?? DEFAULT_SELECTOR_CONFIDENCE;
  const s = 'adapter:selector' as const;

  for (const [field, selectors] of Object.entries(adapter.selectors) as [
    SelectorField,
    string[],
  ][]) {
    const hit = firstMatch(ctx.doc, selectors, MULTI_ELEMENT_FIELDS.has(field));
    if (!hit) continue;
    switch (field) {
      case 'title':
      case 'company':
      case 'location':
        put(out, field, hit.text, confidence, s);
        break;
      case 'description': {
        const el = hit.elements[0];
        put(out, 'description', el ? elementToText(el) : hit.text, confidence, s);
        break;
      }
      case 'salary': {
        // Pills mix salary with other facts; only accept text that parses to an amount.
        const salary = parseSalaryText(pickSalaryChunk(hit.text), defaultCurrencyFor(ctx));
        if (salary?.min !== undefined) put(out, 'salary', salary, confidence, s);
        break;
      }
      case 'employmentType':
        put(out, 'employmentTypes', classifyEmploymentTypes(hit.text.split('·')), confidence, s);
        break;
      case 'workplaceType':
        put(out, 'workplaceType', classifyWorkplace(hit.text), confidence, s);
        break;
      case 'postedAt':
      case 'closesAt':
        put(out, field, toIsoDate(hit.text, ctx.now), confidence, s);
        break;
      case 'applyUrl': {
        const href = hit.elements[0]?.getAttribute('href');
        const url = href ? tryParseUrl(href, ctx.url.href) : undefined;
        put(out, 'applyUrl', url?.href, confidence, s);
        break;
      }
    }
  }
}

/** From "Hybrid · Full-time · $120K/yr - $140K/yr" keep the part with money in it. */
function pickSalaryChunk(text: string): string {
  const chunks = text.split(/\s*·\s*/);
  return (
    chunks.find(
      (c) => /\d/.test(c) && /[$£€₹¥]|\b[A-Z]{3}\b|\d\s?k\b|per|hour|year|annum/i.test(c),
    ) ?? text
  );
}

function runCustom(ctx: ExtractionContext, out: StrategyOutput): void {
  if (!ctx.adapter?.extract) return;
  let custom: Partial<ExtractedFields> = {};
  try {
    custom = ctx.adapter.extract(ctx);
  } catch (error) {
    console.warn(`[rolestash] adapter ${ctx.adapter.id} extract() threw`, error);
  }
  for (const [key, value] of Object.entries(custom)) {
    put(out, key as keyof ExtractedFields, value, CUSTOM_CONFIDENCE, 'adapter:custom');
  }
}

function runTitlePatterns(ctx: ExtractionContext, out: StrategyOutput): void {
  const docTitle = cleanText(ctx.doc.title);
  if (!docTitle || !ctx.adapter?.titlePatterns) return;
  for (const pattern of ctx.adapter.titlePatterns) {
    const groups = pattern.exec(docTitle)?.groups;
    if (!groups) continue;
    for (const key of ['title', 'company', 'location'] as const) {
      const value = cleanText(groups[key]);
      if (value && !isMeaningful(out[key]))
        put(out, key, value, TITLE_PATTERN_CONFIDENCE, 'adapter:title-pattern');
    }
    return;
  }
}

function runUrl(ctx: ExtractionContext, out: StrategyOutput): void {
  const adapter = ctx.adapter;
  if (!adapter) return;
  const company = adapter.companyFromUrl?.(ctx.url);
  if (company) put(out, 'company', company, URL_CONFIDENCE, 'adapter:url');
  const id = adapter.externalId?.(ctx.url);
  if (id) put(out, 'externalId', id, 0.9, 'adapter:url');
}

/** Keeps the higher-confidence value when sub-steps overlap within this strategy. */
function mergeInto(target: StrategyOutput, source: StrategyOutput): void {
  for (const [key, candidate] of Object.entries(source)) {
    const k = key as keyof StrategyOutput;
    const current = target[k];
    if (!current || candidate.confidence > current.confidence) {
      (target as Record<string, unknown>)[k] = candidate;
    }
  }
}

export const adapterStrategy: Strategy = {
  id: 'adapter',
  run(ctx: ExtractionContext): StrategyOutput {
    if (!ctx.adapter) return {};
    const out: StrategyOutput = {};
    const steps = [runUrl, runSelectors, runCustom];
    for (const step of steps) {
      const partial: StrategyOutput = {};
      step(ctx, partial);
      mergeInto(out, partial);
    }
    runTitlePatterns(ctx, out);
    return out;
  },
};
