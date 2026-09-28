import type { ExtractionMeta, Posting } from '@/domain/job';
import { tryParseUrl } from './normalize/url';
import type { ExtractionResult } from './types';

/** Maps an extraction result onto the domain Posting, with safe fallbacks. */
export function toPosting(result: ExtractionResult, overrides: Partial<Posting> = {}): Posting {
  const f = result.fields;
  const posting: Posting = {
    title: (f.title ?? '').slice(0, 300) || 'Untitled position',
    company: (f.company ?? '').slice(0, 200),
    employmentTypes: f.employmentTypes ?? [],
  };
  if (f.location) posting.location = f.location.slice(0, 300);
  if (f.workplaceType) posting.workplaceType = f.workplaceType;
  if (f.salary)
    posting.salary = {
      ...f.salary,
      ...(f.salary.text ? { text: f.salary.text.slice(0, 200) } : {}),
    };
  if (f.postedAt) posting.postedAt = f.postedAt;
  if (f.closesAt) posting.closesAt = f.closesAt;
  if (f.description) posting.description = f.description;
  if (f.externalId) posting.externalId = f.externalId.slice(0, 200);
  if (f.applyUrl && tryParseUrl(f.applyUrl)) posting.applyUrl = f.applyUrl;
  return { ...posting, ...overrides };
}

export function toExtractionMeta(result: ExtractionResult): ExtractionMeta {
  return {
    confidence: result.confidence,
    provenance: Object.fromEntries(
      Object.entries(result.provenance).map(([k, v]) => [k, `${v.strategy}@${v.confidence}`]),
    ),
    extractorVersion: result.extractorVersion,
  };
}
