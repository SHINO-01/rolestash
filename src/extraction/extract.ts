import { resolveAdapter } from './adapters/registry';
import type { SiteAdapter } from './adapters/types';
import { mergeOutputs, overallConfidence } from './merge';
import { classifyWorkplace } from './normalize/classifiers';
import { cleanText } from './normalize/text';
import { bareHost, canonicalizeUrl, tryParseUrl } from './normalize/url';
import { adapterStrategy } from './strategies/adapter';
import { jsonLdStrategy } from './strategies/json-ld';
import { metaStrategy } from './strategies/meta';
import { microdataStrategy } from './strategies/microdata';
import {
  EXTRACTOR_VERSION,
  type ExtractionContext,
  type ExtractionResult,
  type Strategy,
  type StrategyOutput,
} from './types';

/**
 * The extraction pipeline (ADR-0003). Pure: takes a Document and a URL,
 * returns a serialisable result. Runs inside the page (injected on demand)
 * and in unit tests against HTML fixtures.
 */

/** Ordered by trust. Order only matters for ties — see merge.ts. */
export const STRATEGIES: readonly Strategy[] = [
  jsonLdStrategy,
  microdataStrategy,
  adapterStrategy,
  metaStrategy,
];

export interface ExtractOptions {
  now?: Date;
  adapters?: readonly SiteAdapter[];
}

const LOW_CONFIDENCE = 0.6;

export function extractJob(
  doc: Document,
  href: string,
  options: ExtractOptions = {},
): ExtractionResult {
  const now = options.now ?? new Date();
  const url = tryParseUrl(href);
  if (!url) return emptyResult(href, 'The page URL could not be parsed.');

  const adapter = resolveAdapter(url, doc, options.adapters);
  const ctx: ExtractionContext = { doc, url, adapter, now };

  const outputs = STRATEGIES.map((strategy) => runSafely(strategy, ctx));
  const { fields, provenance } = mergeOutputs(outputs);
  const siteName = adapter?.name ?? bareHost(url);

  // --- Post-processing: cross-field cleanup the strategies can't do alone ---
  if (fields.company) {
    const company = cleanCompany(fields.company);
    if (!company || looksLikeSiteName(company, siteName, url)) {
      delete fields.company;
      delete provenance.company;
    } else {
      fields.company = company;
    }
  }
  if (fields.title) fields.title = cleanTitle(fields.title);
  if (!fields.workplaceType) {
    const inferred = classifyWorkplace(fields.location);
    if (inferred) {
      fields.workplaceType = inferred;
      provenance.workplaceType = { strategy: 'heuristic', confidence: 0.6 };
    }
  }

  const canonical = safeCanonical(adapter, url);
  const confidence = overallConfidence(provenance);
  const hasStructuredData = outputs[0] !== undefined && Object.keys(outputs[0]).length > 0;
  const isJobPage =
    hasStructuredData ||
    Object.keys(outputs[1] ?? {}).length > 0 ||
    (adapter !== undefined && (provenance.title?.confidence ?? 0) >= 0.7) ||
    confidence >= LOW_CONFIDENCE;

  const warnings: string[] = [];
  if (!fields.title) warnings.push('No job title found.');
  if (!fields.company) warnings.push('No company found.');
  if (!isJobPage) warnings.push('This page may not be a single job posting.');

  return {
    url: canonical,
    originalUrl: url.href,
    site: adapter ? { id: adapter.id, name: adapter.name } : { id: 'generic', name: siteName },
    fields,
    provenance,
    confidence,
    isJobPage,
    warnings,
    extractorVersion: EXTRACTOR_VERSION,
  };
}

function runSafely(strategy: Strategy, ctx: ExtractionContext): StrategyOutput {
  try {
    return strategy.run(ctx);
  } catch (error) {
    console.warn(`[jobtrail] strategy ${strategy.id} failed`, error);
    return {};
  }
}

function safeCanonical(adapter: SiteAdapter | undefined, url: URL): string {
  try {
    const custom = adapter?.canonicalUrl?.(url);
    if (custom) return custom;
  } catch (error) {
    console.warn('[jobtrail] canonicalUrl failed', error);
  }
  return canonicalizeUrl(url.href);
}

export function cleanCompany(value: string): string {
  return cleanText(value)
    .replace(/^(at|@)\s+/i, '')
    .replace(/\s*\d(?:\.\d)?\s*★+\s*$/, '') // "Acme 4.2 ★" (Glassdoor)
    .replace(/\s*★.*$/, '')
    .replace(/\s*(logo|company logo)$/i, '')
    .trim();
}

export function cleanTitle(value: string): string {
  return cleanText(value)
    .replace(/\s*-\s*job post$/i, '') // Indeed's visually-hidden suffix
    .replace(/\s*\(\s*\)$/, '');
}

function looksLikeSiteName(company: string, siteName: string, url: URL): boolean {
  const c = company.toLowerCase();
  const host = bareHost(url);
  return (
    c === siteName.toLowerCase() ||
    c === host ||
    host.split('.').includes(c) ||
    /^(careers?|jobs?|job board|home)$/i.test(company)
  );
}

function emptyResult(href: string, warning: string): ExtractionResult {
  return {
    url: href,
    originalUrl: href,
    site: { id: 'generic', name: 'Unknown' },
    fields: {},
    provenance: {},
    confidence: 0,
    isJobPage: false,
    warnings: [warning],
    extractorVersion: EXTRACTOR_VERSION,
  };
}
