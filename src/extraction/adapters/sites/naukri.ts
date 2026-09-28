import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'naukri',
  name: 'Naukri',
  kind: 'job-board',
  regions: ['IN'],
  homepage: 'https://www.naukri.com',
  hosts: ['naukri.com'],
  externalId: (url) => /-(\d{10,})$/.exec(url.pathname)?.[1],
  defaultCurrency: 'INR',
  selectors: {
    title: ['[class*="jd-header-title"]', 'h1'],
    company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]'],
    location: ['[class*="location"] a', '[class*="loc"] a'],
    salary: ['[class*="salary"]'],
    description: ['[class*="job-desc"]', '[class*="dang-inner-html"]'],
  },
  notes:
    'Salaries are often in lakhs per annum (“12-18 Lacs P.A.”), which the salary parser understands.',
});
