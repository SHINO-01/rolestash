import { canonicalFromId, currencyFromHost, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/(?:details|land\/ad)\/(\d+)/);

export default defineAdapter({
  id: 'adzuna',
  name: 'Adzuna',
  kind: 'aggregator',
  regions: ['global', 'AU', 'UK'],
  homepage: 'https://www.adzuna.com.au',
  hosts: [/(^|\.)adzuna\.[a-z.]+$/],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/details/{id}'),
  defaultCurrency: currencyFromHost('USD'),
  selectors: {
    title: ['.ui-job-title h1', 'main h1', 'h1'],
    company: ['.ui-company', '[data-js="company"]'],
    location: ['.ui-location', '[data-js="location"]'],
    salary: ['.ui-salary', '[data-js="salary"]'],
    description: ['.adp-body', '.ui-description', 'section.adp-body'],
  },
  notes: 'Aggregator; `/land/ad/{id}` redirect URLs resolve to `/details/{id}`.',
});
