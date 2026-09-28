import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'ethicaljobs',
  name: 'EthicalJobs',
  kind: 'job-board',
  regions: ['AU'],
  homepage: 'https://www.ethicaljobs.com.au',
  hosts: ['ethicaljobs.com.au'],
  defaultCurrency: 'AUD',
  // /members/{organisation}/{job-slug}
  companyFromUrl: (url) =>
    url.pathname.startsWith('/members/') ? companyFromPath(url, 1) : undefined,
  selectors: {
    title: ['h1'],
    company: ['.organisation-name', '[data-testid="organisation-name"]'],
    location: ['.job-location', '[data-testid="job-location"]'],
    description: ['.job-description', '[data-testid="job-description"]'],
  },
  notes: 'Non-profit and for-purpose sector.',
});
