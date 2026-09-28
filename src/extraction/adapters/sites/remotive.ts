import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'remotive',
  name: 'Remotive',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://remotive.com',
  hosts: ['remotive.com', 'remotive.io'],
  externalId: (url) => /-(\d+)$/.exec(url.pathname)?.[1],
  defaultCurrency: 'USD',
  extract: () => ({ workplaceType: 'remote' }),
  selectors: {
    title: ['h1'],
    description: ['.left > .job-description', '#job-description', '.job-description'],
  },
});
