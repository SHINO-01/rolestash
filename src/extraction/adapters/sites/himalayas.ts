import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'himalayas',
  name: 'Himalayas',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://himalayas.app',
  hosts: ['himalayas.app'],
  // /companies/{company}/jobs/{slug}
  companyFromUrl: (url) =>
    url.pathname.startsWith('/companies/') ? companyFromPath(url, 1) : undefined,
  defaultCurrency: 'USD',
  extract: () => ({ workplaceType: 'remote' }),
  selectors: {
    title: ['h1'],
    description: ['article', '.job-description'],
  },
});
