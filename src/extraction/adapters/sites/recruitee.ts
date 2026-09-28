import { companyFromSubdomain } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'recruitee',
  name: 'Recruitee',
  kind: 'ats',
  regions: ['EU', 'global'],
  homepage: 'https://recruitee.com',
  hosts: ['recruitee.com'],
  externalId: (url) => /\/o\/([^/]+)/.exec(url.pathname)?.[1],
  companyFromUrl: (url) => companyFromSubdomain(url),
  selectors: {
    title: ['h1'],
    description: ['[class*="job-description"]', '.description'],
  },
  notes: 'acme.recruitee.com/o/{slug}. JSON-LD present on hosted career sites.',
});
