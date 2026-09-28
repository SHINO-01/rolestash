import type { DomainContext } from '@/domain/job-factory';
import type { Job } from '@/domain/job';
import type { ExtractionResult } from '@/extraction';
import { EXTRACTOR_VERSION } from '@/extraction';

/** Deterministic clock + id generator for tests. */
export function testContext(
  start = '2026-09-28T00:00:00.000Z',
): DomainContext & { advance: (ms: number) => void } {
  let now = new Date(start).getTime();
  let id = 0;
  return {
    now: () => new Date(now),
    newId: () => `id-${++id}`,
    advance: (ms) => {
      now += ms;
    },
  };
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  const at = '2026-09-01T00:00:00.000Z';
  return {
    id: overrides.id ?? `job-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Software Engineer',
    company: 'Acme',
    employmentTypes: [],
    stageId: 'saved',
    rank: 1024,
    priority: 0,
    tags: [],
    notes: '',
    source: {
      url: `https://example.com/jobs/${overrides.id ?? 'x'}`,
      originalUrl: `https://example.com/jobs/${overrides.id ?? 'x'}`,
      siteId: 'generic',
      siteName: 'example.com',
      capturedAt: at,
    },
    activity: [],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function makeResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    originalUrl: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=x',
    site: { id: 'greenhouse', name: 'Greenhouse' },
    fields: { title: 'Backend Engineer', company: 'Acme', location: 'Sydney', externalId: '1' },
    provenance: { title: { strategy: 'json-ld', confidence: 0.95 } },
    confidence: 0.9,
    isJobPage: true,
    warnings: [],
    extractorVersion: EXTRACTOR_VERSION,
    ...overrides,
  };
}
