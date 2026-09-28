import { currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'stepstone',
  name: 'StepStone',
  kind: 'job-board',
  regions: ['EU', 'UK'],
  homepage: 'https://www.stepstone.de',
  hosts: [/(^|\.)stepstone\.(de|at|be|nl|fr|pl|co\.uk)$/],
  externalId: (url) => /--(\d+)-inline\.html$/.exec(url.pathname)?.[1],
  defaultCurrency: currencyFromHost('EUR'),
  selectors: {
    title: ['[data-at="header-job-title"]', 'h1'],
    company: ['[data-at="metadata-company-name"]', '[data-at="header-company-name"]'],
    location: ['[data-at="metadata-location"]'],
    salary: ['[data-at="metadata-salary"]'],
    employmentType: ['[data-at="metadata-contract-type"]', '[data-at="metadata-work-type"]'],
    description: ['[data-at="job-ad-content"]'],
  },
});
