import { canonicalFromId, currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';
import { SEEK_PLATFORM_SELECTORS, seekJobId } from './seek';

export default defineAdapter({
  id: 'jobstreet',
  name: 'JobStreet / Jobsdb',
  kind: 'job-board',
  regions: ['SEA'],
  homepage: 'https://www.jobstreet.com',
  hosts: [/(^|\.)jobstreet\.(com|com\.my|com\.sg|com\.ph|co\.id|vn)$/, 'jobsdb.com'],
  externalId: seekJobId,
  canonicalUrl: canonicalFromId(seekJobId, '/job/{id}'),
  defaultCurrency: currencyFromHost(),
  selectors: SEEK_PLATFORM_SELECTORS,
  notes:
    'Runs on the SEEK platform since the 2024 unification, so it reuses SEEK’s selectors. Country is a subdomain (my.jobstreet.com, hk.jobsdb.com).',
});
