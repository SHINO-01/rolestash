import { canonicalFromId, companyFromSubdomain, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/apply\/([A-Za-z0-9]+)/);

export default defineAdapter({
  id: 'jazzhr',
  name: 'JazzHR',
  kind: 'ats',
  regions: ['US', 'global'],
  homepage: 'https://www.jazzhr.com',
  hosts: ['applytojob.com'],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/apply/{id}'),
  companyFromUrl: (url) => companyFromSubdomain(url),
  selectors: {
    title: ['.job-header h1', '#resumator-job-title', 'h1'],
    location: [
      '.job-attributes-container [title="Location"]',
      '#resumator-job-location',
      '.job-header .location',
    ],
    employmentType: ['.job-attributes-container [title="Type"]', '#resumator-job-type'],
    description: ['#job-description', '#resumator-job-description', '.job-details'],
  },
  notes: 'Formerly “The Resumator”; legacy `#resumator-*` ids are kept as fallbacks.',
});
