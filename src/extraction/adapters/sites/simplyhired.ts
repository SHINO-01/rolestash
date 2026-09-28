import { canonicalFromId, currencyFromHost, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/job\/([A-Za-z0-9_-]+)/);

export default defineAdapter({
  id: 'simplyhired',
  name: 'SimplyHired',
  kind: 'aggregator',
  regions: ['US', 'UK', 'global'],
  homepage: 'https://www.simplyhired.com',
  hosts: [/(^|\.)simplyhired\.(com|co\.uk|ca|com\.au)$/],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/job/{id}'),
  defaultCurrency: currencyFromHost('USD'),
  selectors: {
    title: ['[data-testid="viewJobTitle"]', 'h1'],
    company: ['[data-testid="viewJobCompanyName"]'],
    location: ['[data-testid="viewJobCompanyLocation"]'],
    salary: ['[data-testid="viewJobBodyJobCompensation"]'],
    employmentType: ['[data-testid="viewJobBodyJobDetailsJobType"]'],
    description: ['[data-testid="viewJobBodyJobFullDescriptionContent"]'],
  },
  notes:
    'Owned by Indeed; the search pane selects jobs with `?job=` which is kept by generic canonicalisation.',
});
