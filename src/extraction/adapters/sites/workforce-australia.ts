import { pathId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'workforce-australia',
  name: 'Workforce Australia',
  kind: 'government',
  regions: ['AU'],
  homepage: 'https://www.workforceaustralia.gov.au',
  hosts: ['workforceaustralia.gov.au'],
  externalId: pathId(/\/jobs\/details\/(\d+)/),
  defaultCurrency: 'AUD',
  selectors: {
    title: ['main h1', 'h1'],
    company: ['.job-details__employer', '[data-testid="employer-name"]'],
    location: ['.job-details__location', '[data-testid="job-location"]'],
    description: ['.job-details__description', '[data-testid="job-description"]'],
  },
});
