import { buildUrl } from '../../normalize/url';
import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

const UUID = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export default defineAdapter({
  id: 'lever',
  name: 'Lever',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.lever.co',
  hosts: ['lever.co'],
  externalId: (url) => UUID.exec(url.pathname)?.[1],
  // Drop the trailing `/apply` so the application form and posting dedupe together.
  canonicalUrl: (url) => {
    const id = UUID.exec(url.pathname)?.[1];
    const company = url.pathname.split('/').find(Boolean);
    return id && company ? buildUrl(url.hostname, `/${company}/${id}`) : undefined;
  },
  companyFromUrl: (url) => companyFromPath(url, 0),
  selectors: {
    title: ['.posting-headline h2', '.posting-header h2'],
    company: ['.main-header-logo img@alt'],
    location: ['.posting-categories .location', '.posting-category.location'],
    employmentType: ['.posting-categories .commitment'],
    workplaceType: ['.posting-categories .workplaceTypes'],
    description: ['[data-qa="job-description"]', '.posting-page .content'],
  },
  notes: 'jobs.lever.co/{company}/{uuid}; the EU instance is jobs.eu.lever.co.',
});
