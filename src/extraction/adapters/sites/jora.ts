import { currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'jora',
  name: 'Jora',
  kind: 'aggregator',
  regions: ['AU', 'NZ', 'SEA'],
  homepage: 'https://au.jora.com',
  hosts: ['jora.com'],
  defaultCurrency: currencyFromHost('AUD'),
  selectors: {
    title: ['.job-view-content h1', 'h1.job-title', '.job-title'],
    company: ['.job-view-content .company', '.company'],
    location: ['.job-view-content .location', '.location'],
    salary: ['.job-view-content .salary', '.salary'],
    employmentType: ['.job-view-content .badge', '.badge'],
    description: ['#job-description-container', '.job-description-container'],
  },
  notes:
    'Aggregator owned by SEEK; many postings link out to the original ad. Country subdomains (au., nz., sg.).',
});
