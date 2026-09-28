import { buildUrl } from '../../normalize/url';
import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

const id = (url: URL): string | undefined => /\/j\/([A-Z0-9]+)/i.exec(url.pathname)?.[1];

export default defineAdapter({
  id: 'workable',
  name: 'Workable',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.workable.com',
  hosts: ['workable.com'],
  externalId: id,
  canonicalUrl: (url) => {
    const jobId = id(url);
    const company = url.pathname.split('/').find(Boolean);
    return jobId && company ? buildUrl(url.hostname, `/${company}/j/${jobId}`) : undefined;
  },
  companyFromUrl: (url) =>
    url.hostname.startsWith('apply.') ? companyFromPath(url, 0) : undefined,
  selectors: {
    title: ['[data-ui="job-title"]', 'h1'],
    location: ['[data-ui="job-location"]'],
    employmentType: ['[data-ui="job-type"]'],
    workplaceType: ['[data-ui="job-workplace"]'],
    description: ['[data-ui="job-description"]', '[data-ui="job-breakdown"]'],
  },
  notes: 'apply.workable.com/{company}/j/{shortcode}; `data-ui` hooks are stable.',
});
