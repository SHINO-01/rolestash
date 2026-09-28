import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'totaljobs',
  name: 'Totaljobs',
  kind: 'job-board',
  regions: ['UK'],
  homepage: 'https://www.totaljobs.com',
  hosts: ['totaljobs.com'],
  externalId: (url) => /job(\d+)(?:$|[/?])/.exec(url.pathname)?.[1],
  defaultCurrency: 'GBP',
  selectors: {
    title: ['[data-at="header-job-title"]', 'h1'],
    company: ['[data-at="metadata-company-name"]', '[data-at="header-company-name"]'],
    location: ['[data-at="metadata-location"]'],
    salary: ['[data-at="metadata-salary"]'],
    employmentType: ['[data-at="metadata-work-type"]'],
    description: ['[data-at="section-text-jobDescription-content"]', '[data-at="job-ad-content"]'],
  },
  notes: 'Runs on the StepStone platform; `data-at` hooks are shared with StepStone.',
});
