import { companyFromPath, currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'prosple',
  name: 'Prosple',
  kind: 'job-board',
  regions: ['AU', 'NZ', 'UK', 'SEA'],
  homepage: 'https://au.prosple.com',
  hosts: ['prosple.com'],
  defaultCurrency: currencyFromHost('AUD'),
  // /graduate-employers/{company}/jobs-internships/{slug}
  companyFromUrl: (url) =>
    url.pathname.startsWith('/graduate-employers/') ? companyFromPath(url, 1) : undefined,
  selectors: {
    title: ['h1'],
    description: ['[data-testid="opportunity-description"]', '.opportunity-description'],
  },
  notes: 'Graduate programs and internships. Next.js app; JSON-LD is the primary source.',
});
