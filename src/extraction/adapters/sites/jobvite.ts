import { buildUrl } from '../../normalize/url';
import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

const id = (url: URL): string | undefined => /\/job\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1];

export default defineAdapter({
  id: 'jobvite',
  name: 'Jobvite',
  kind: 'ats',
  regions: ['US', 'global'],
  homepage: 'https://www.jobvite.com',
  hosts: ['jobvite.com'],
  externalId: id,
  canonicalUrl: (url) => {
    const jobId = id(url);
    const company = url.pathname.split('/').find(Boolean);
    return jobId && company ? buildUrl(url.hostname, `/${company}/job/${jobId}`) : undefined;
  },
  companyFromUrl: (url) => (url.hostname.startsWith('jobs.') ? companyFromPath(url, 0) : undefined),
  selectors: {
    title: ['.jv-header', 'h2.jv-header', 'h1'],
    location: ['.jv-job-detail-meta'],
    description: ['.jv-job-detail-description'],
  },
});
