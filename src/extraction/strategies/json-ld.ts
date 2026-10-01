import { classifyEmploymentTypes } from '../normalize/classifiers';
import { toIsoDate } from '../normalize/dates';
import { salaryFromSchema } from '../normalize/salary';
import { cleanText, decodeEntities, htmlToText } from '../normalize/text';
import { canonicalizeUrl } from '../normalize/url';
import type { ExtractedFields, ExtractionContext, Strategy, StrategyOutput } from '../types';
import { defaultCurrencyFor, put } from './shared';

/**
 * schema.org JobPosting in JSON-LD — the most reliable source, because job
 * sites publish it for Google for Jobs.
 */

type Json = Record<string, unknown>;

const CONFIDENCE = 0.95;
/** Several postings on one page (e.g. a list view) and none matches the URL. */
const AMBIGUOUS_CONFIDENCE = 0.6;

export function parseJsonLdBlocks(doc: Document): unknown[] {
  const blocks: unknown[] = [];
  for (const script of doc.querySelectorAll('script[type*="ld+json" i]')) {
    const text = script.textContent;
    if (!text.trim()) continue;
    const parsed = parseLenient(text);
    if (parsed !== undefined) blocks.push(parsed);
  }
  return blocks;
}

/** JSON.parse with repairs for the usual real-world breakage. */
export function parseLenient(text: string): unknown {
  const attempts = [
    text,
    text
      .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')
      .replace(/^\s*\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
      // Raw control characters inside strings are invalid JSON but common.
      // eslint-disable-next-line no-control-regex -- matching control chars is the point
      .replace(/[\u0000-\u001f]+/g, ' ')
      // Trailing commas.
      .replace(/,\s*([}\]])/g, '$1'),
  ];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function isJobPosting(node: Json): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && /(^|[/#:])JobPosting$/i.test(t));
}

/** Walks arrays, @graph, mainEntity and nested objects collecting JobPosting nodes. */
export function findJobPostings(root: unknown, depth = 0): Json[] {
  if (depth > 6 || root === null || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap((item) => findJobPostings(item, depth + 1));
  const node = root as Json;
  if (isJobPosting(node)) return [node];
  return Object.values(node).flatMap((value) =>
    value && typeof value === 'object' ? findJobPostings(value, depth + 1) : [],
  );
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanText(decodeEntities(value)) || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (value && typeof value === 'object') {
    const obj = value as Json;
    return text(obj.name ?? obj['@value'] ?? obj.value);
  }
  return undefined;
}

function addressToString(address: unknown): string | undefined {
  if (typeof address === 'string') return text(address);
  if (!address || typeof address !== 'object') return undefined;
  const a = address as Json;
  // Split each part on commas, so "Israel, Raanana" + "Israel" doesn't repeat
  // the country; the last mention of a place wins (city, region, country order).
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
    .map((p) => text(p))
    .filter((p): p is string => Boolean(p))
    .flatMap((p) => p.split(/\s*,\s*/))
    .filter(Boolean);
  const unique = parts.filter(
    (p, i) => parts.findLastIndex((q) => q.toLowerCase() === p.toLowerCase()) === i,
  );
  const joined = unique.join(', ');
  return joined !== '' ? joined : (text(a.streetAddress) ?? text(a.name));
}

export function locationFromJobLocation(jobLocation: unknown): string | undefined {
  const places = (Array.isArray(jobLocation) ? jobLocation : [jobLocation]).filter(Boolean);
  const names = places
    .map((place) => {
      if (typeof place === 'string') return text(place);
      const p = place as Json;
      return addressToString(p.address) ?? text(p.name);
    })
    .filter((n): n is string => Boolean(n));
  const unique = [...new Set(names)];
  if (unique.length === 0) return undefined;
  if (unique.length <= 3) return unique.join('; ');
  return `${unique.slice(0, 2).join('; ')} +${unique.length - 2} more`;
}

function identifierOf(value: unknown): string | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Json;
    return text(obj.value ?? obj.name);
  }
  return text(value);
}

function scorePosting(node: Json, url: URL): number {
  let score = 0;
  const nodeUrl = typeof node.url === 'string' ? node.url : undefined;
  if (nodeUrl) {
    try {
      if (canonicalizeUrl(new URL(nodeUrl, url).href) === canonicalizeUrl(url.href)) score += 10;
    } catch {
      /* ignore */
    }
  }
  if (node.title ?? node.name) score += 2;
  if (node.hiringOrganization) score += 2;
  if (node.description) score += 1;
  return score;
}

export function mapJobPosting(
  node: Json,
  ctx: ExtractionContext,
): Partial<Record<keyof ExtractedFields, unknown>> {
  const out: Partial<Record<keyof ExtractedFields, unknown>> = {};
  out.title = text(node.title) ?? text(node.name);
  out.company = text(node.hiringOrganization);

  const remote =
    /TELECOMMUTE/i.test(JSON.stringify(node.jobLocationType ?? '')) ||
    node.jobLocationType === 'REMOTE';
  let location = locationFromJobLocation(node.jobLocation);
  if (!location && remote) {
    const requirements = locationFromJobLocation(node.applicantLocationRequirements);
    location = requirements ? `Remote (${requirements})` : 'Remote';
  }
  out.location = location;
  if (remote) out.workplaceType = 'remote';

  const employment = classifyEmploymentTypes(node.employmentType);
  if (employment.length) out.employmentTypes = employment;

  out.salary =
    salaryFromSchema(node.baseSalary, defaultCurrencyFor(ctx)) ??
    salaryFromSchema(node.estimatedSalary, defaultCurrencyFor(ctx));
  out.postedAt = toIsoDate(node.datePosted, ctx.now);
  out.closesAt = toIsoDate(node.validThrough, ctx.now);
  out.description = typeof node.description === 'string' ? htmlToText(node.description) : undefined;
  out.externalId = identifierOf(node.identifier);
  return out;
}

export const jsonLdStrategy: Strategy = {
  id: 'json-ld',
  run(ctx: ExtractionContext): StrategyOutput {
    const postings = parseJsonLdBlocks(ctx.doc).flatMap((b) => findJobPostings(b));
    if (postings.length === 0) return {};

    const ranked = postings
      .map((node) => ({ node, score: scorePosting(node, ctx.url) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best) return {};
    const ambiguous = postings.length > 1 && best.score < 10;
    const confidence = ambiguous ? AMBIGUOUS_CONFIDENCE : CONFIDENCE;

    const out: StrategyOutput = {};
    const mapped = mapJobPosting(best.node, ctx);
    for (const [key, value] of Object.entries(mapped)) {
      put(out, key as keyof ExtractedFields, value, confidence, 'json-ld');
    }
    return out;
  },
};
