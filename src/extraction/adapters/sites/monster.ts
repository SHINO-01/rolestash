import { currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'monster',
  name: 'Monster',
  kind: 'job-board',
  regions: ['US', 'UK', 'EU'],
  homepage: 'https://www.monster.com',
  hosts: [/(^|\.)monster\.(com|co\.uk|ca|de|fr|nl|be|at|ie|it|es|se|ch)$/],
  defaultCurrency: currencyFromHost('USD'),
  selectors: {
    title: ['[data-testid="jobTitle"]', '[data-testid="svx-job-title"]', 'h1'],
    company: ['[data-testid="company"]', '[data-testid="svx-job-company"]'],
    location: ['[data-testid="jobDetailLocation"]', '[data-testid="svx-job-location"]'],
    salary: ['[data-testid="svx-job-salary"]'],
    description: [
      '[data-testid="svx-description-container-inner"]',
      '[data-testid="svx-job-description"]',
    ],
  },
});
