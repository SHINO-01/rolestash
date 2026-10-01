import { cleanText } from '../../normalize/text';
import { toIsoDate } from '../../normalize/dates';
import { canonicalFromId } from '../helpers';
import { defineAdapter } from '../types';

const jobId = (url: URL): string | undefined =>
  /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/.exec(url.pathname)?.[1] ??
  url.searchParams.get('currentJobId') ??
  undefined;

export default defineAdapter({
  id: 'linkedin',
  name: 'LinkedIn',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://www.linkedin.com/jobs',
  lastVerified: '2026-10-01',
  hosts: ['linkedin.com'],
  externalId: jobId,
  // Search/collection views (`/jobs/search?currentJobId=…`) resolve to the posting URL.
  canonicalUrl: canonicalFromId(jobId, '/jobs/view/{id}', 'linkedin.com'),
  selectors: {
    title: [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.top-card-layout__title',
      '.topcard__title',
    ],
    company: [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '.top-card-layout__second-subline a',
    ],
    location: ['.topcard__flavor--bullet', '.jobs-unified-top-card__bullet'],
    workplaceType: [
      '.job-details-fit-level-preferences',
      '.job-details-preferences-and-skills',
      '.jobs-unified-top-card__workplace-type',
    ],
    employmentType: [
      '.job-details-fit-level-preferences',
      '.job-details-preferences-and-skills',
      '.description__job-criteria-list',
    ],
    salary: ['.job-details-fit-level-preferences', '.compensation__salary'],
    description: [
      '#job-details',
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.show-more-less-html__markup',
      '.description__text',
    ],
    postedAt: ['.posted-time-ago__text'],
  },
  // The signed-in top card renders "Sydney, NSW · 3 days ago · 42 applicants".
  extract: ({ doc, now }) => {
    const line = doc.querySelector(
      '.job-details-jobs-unified-top-card__tertiary-description-container, .job-details-jobs-unified-top-card__primary-description-container',
    );
    if (!line) return {};
    const parts = cleanText(line.textContent)
      .split('·')
      .map((p) => p.trim())
      .filter(Boolean);
    const out: { location?: string; postedAt?: string } = {};
    const [first, ...rest] = parts;
    if (first && !/ago|applicant|click/i.test(first)) out.location = first;
    const posted = rest.find((p) => /ago|today|yesterday/i.test(p));
    const iso = posted ? toIsoDate(posted.replace(/^reposted\s+/i, ''), now) : undefined;
    if (iso) out.postedAt = iso;
    return out;
  },
  titlePatterns: [
    /^(?:\(\d+\)\s*)?(?<company>.+?) hiring (?<title>.+?) in (?<location>.+?) \| LinkedIn$/i,
    /^(?:\(\d+\)\s*)?(?<title>.+?) \| (?<company>.+?) \| LinkedIn$/i,
  ],
  notes:
    'Two layouts: the public guest page (has JSON-LD) and the signed-in SPA (no JSON-LD; selectors + title pattern). ' +
    'In search view the selected job is read from `currentJobId`. LinkedIn changes class names often — check this adapter first when captures degrade.',
});
