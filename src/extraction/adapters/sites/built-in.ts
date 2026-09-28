import { pathId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'built-in',
  name: 'Built In',
  kind: 'job-board',
  regions: ['US'],
  homepage: 'https://builtin.com',
  hosts: [/(^|\.)builtin(nyc|la|chicago|austin|boston|colorado|seattle|sf)?\.com$/],
  externalId: pathId(/\/job\/[^/]+\/(\d+)/),
  defaultCurrency: 'USD',
  selectors: {
    title: ['h1'],
    company: ['[data-id="company-title"]', '.job-info h2 a', 'h2 a[href*="/company/"]'],
    description: ['.job-description', '[data-id="job-description"]'],
  },
  notes: 'Legacy city sites (builtinnyc.com etc.) redirect to builtin.com.',
});
