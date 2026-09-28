import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'careerone',
  name: 'CareerOne',
  kind: 'job-board',
  regions: ['AU'],
  homepage: 'https://www.careerone.com.au',
  hosts: ['careerone.com.au'],
  defaultCurrency: 'AUD',
  selectors: {
    title: ['[data-testid="job-title"]', '.job-title h1', 'h1'],
    company: ['[data-testid="company-name"]', '.company-name'],
    location: ['[data-testid="job-location"]', '.job-location'],
    salary: ['[data-testid="job-salary"]', '.job-salary'],
    description: ['[data-testid="job-description"]', '.job-description'],
  },
});
