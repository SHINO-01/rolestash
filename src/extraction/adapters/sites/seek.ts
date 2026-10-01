import { buildUrl } from '../../normalize/url';
import { currencyFromHost, pathId, queryId } from '../helpers';
import { defineAdapter, type SiteAdapter } from '../types';

/** Shared by every site on the SEEK platform (SEEK, JobStreet, Jobsdb). */
export const SEEK_PLATFORM_SELECTORS: NonNullable<SiteAdapter['selectors']> = {
  title: ['[data-automation="job-detail-title"]', 'h1[data-automation]'],
  company: ['[data-automation="advertiser-name"]'],
  location: ['[data-automation="job-detail-location"]'],
  salary: ['[data-automation="job-detail-salary"]'],
  employmentType: ['[data-automation="job-detail-work-type"]'],
  workplaceType: [
    '[data-automation="job-detail-work-arrangements"]',
    '[data-automation="job-detail-location"]',
  ],
  description: ['[data-automation="jobAdDetails"]'],
  postedAt: ['[data-automation="job-detail-date"]'],
};

export const seekJobId = (url: URL): string | undefined =>
  pathId(/\/job\/(\d+)/)(url) ?? queryId('jobId')(url);

export default defineAdapter({
  id: 'seek',
  name: 'SEEK',
  kind: 'job-board',
  regions: ['AU', 'NZ'],
  homepage: 'https://au.seek.com',
  lastVerified: '2026-10-01',
  // SEEK moved to au.seek.com and nz.seek.com in 2026; the old domains redirect.
  hosts: ['seek.com', 'seek.com.au', 'seek.co.nz'],
  externalId: seekJobId,
  // Search view (`/software-jobs?jobId=…`) resolves to the posting, on the
  // current domain, so old seek.com.au links match new au.seek.com ones.
  canonicalUrl: (url) => {
    const id = seekJobId(url);
    const nz = /(^|\.)nz\.|\.nz$/.test(url.hostname);
    return id ? buildUrl(nz ? 'nz.seek.com' : 'au.seek.com', `/job/${id}`) : undefined;
  },
  defaultCurrency: currencyFromHost('AUD'),
  selectors: SEEK_PLATFORM_SELECTORS,
  titlePatterns: [/^(?<title>.+?) Job in (?<location>.+?) - SEEK$/i],
  notes:
    '`data-automation` attributes are SEEK’s test hooks and have been stable for years. The same platform powers JobStreet and Jobsdb (see `jobstreet`).',
});
