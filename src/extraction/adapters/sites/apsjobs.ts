import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'apsjobs',
  name: 'APSjobs',
  kind: 'government',
  regions: ['AU'],
  homepage: 'https://www.apsjobs.gov.au',
  hosts: ['apsjobs.gov.au'],
  defaultCurrency: 'AUD',
  selectors: {
    title: ['.job-details h1', 'h1'],
    company: ['.job-details .agency', '[data-label="Agency"]'],
    location: ['[data-label="Location"]', '.job-details .location'],
    salary: ['[data-label="Salary"]', '.job-details .salary'],
    closesAt: ['[data-label="Closing Date"]', '.closing-date'],
    description: ['.job-details .description', '.job-description', 'main'],
  },
  notes:
    'Australian Public Service jobs. Built on Salesforce Experience Cloud (a slow SPA) — capture after the page has fully rendered. "Company" is the hiring agency.',
});
