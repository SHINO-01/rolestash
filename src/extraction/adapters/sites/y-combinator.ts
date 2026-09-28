import { companyFromPath, pathId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'y-combinator',
  name: 'Y Combinator (Work at a Startup)',
  kind: 'job-board',
  regions: ['global', 'US'],
  homepage: 'https://www.workatastartup.com',
  hosts: ['workatastartup.com', 'ycombinator.com'],
  externalId: pathId(/\/jobs\/(\w+)/),
  // ycombinator.com/companies/{company}/jobs/{id}-{slug}
  companyFromUrl: (url) =>
    url.hostname.endsWith('ycombinator.com') && url.pathname.startsWith('/companies/')
      ? companyFromPath(url, 1)
      : undefined,
  selectors: {
    title: ['.company-details h1', 'h1'],
    company: ['.company-name', '.company-details .company-title'],
    location: ['.job-details .location', '.company-details .location'],
    description: ['.prose', '.job-description'],
  },
  titlePatterns: [/^(?<title>.+?) at (?<company>.+?) \| Y Combinator$/i],
  notes: 'Covers both workatastartup.com and ycombinator.com/companies/*/jobs pages.',
});
