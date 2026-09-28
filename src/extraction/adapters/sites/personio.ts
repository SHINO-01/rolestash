import { canonicalFromId, companyFromSubdomain, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/job\/(\d+)/);

export default defineAdapter({
  id: 'personio',
  name: 'Personio',
  kind: 'ats',
  regions: ['EU'],
  homepage: 'https://www.personio.com',
  hosts: [/\.jobs\.personio\.(de|com)$/],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/job/{id}'),
  companyFromUrl: (url) => companyFromSubdomain(url),
  defaultCurrency: 'EUR',
  selectors: {
    title: ['h1'],
    description: ['[class*="job-description"]', '.job-details'],
  },
  notes: 'acme.jobs.personio.de/job/{id}.',
});
