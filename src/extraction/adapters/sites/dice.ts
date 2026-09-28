import { canonicalFromId, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/job-detail\/([0-9a-f-]{36})/i);

export default defineAdapter({
  id: 'dice',
  name: 'Dice',
  kind: 'job-board',
  regions: ['US'],
  homepage: 'https://www.dice.com',
  hosts: ['dice.com'],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/job-detail/{id}'),
  defaultCurrency: 'USD',
  selectors: {
    title: ['[data-cy="jobTitle"]', 'h1'],
    company: ['[data-cy="companyNameLink"]', '[data-cy="companyName"]'],
    location: ['[data-cy="location"]', '[data-cy="locationDetails"]'],
    salary: ['[data-cy="payDetails"]', '[data-cy="compensationText"]'],
    employmentType: ['[data-cy="employmentDetails"]'],
    description: ['[data-testid="jobDescriptionHtml"]', '#jobDescription'],
  },
  notes: 'Tech-focused US board.',
});
