import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'smartrecruiters',
  name: 'SmartRecruiters',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.smartrecruiters.com',
  hosts: ['smartrecruiters.com'],
  externalId: (url) => /\/(\d{6,})(?:-|$)/.exec(url.pathname)?.[1],
  companyFromUrl: (url) => (url.hostname.startsWith('jobs.') ? companyFromPath(url, 0) : undefined),
  selectors: {
    title: ['h1.job-title', '[itemprop="title"]'],
    company: ['[itemprop="hiringOrganization"] [itemprop="name"]@content'],
    location: ['spl-job-location@formattedaddress', '[itemprop="jobLocation"]'],
    employmentType: ['[itemprop="employmentType"]'],
    description: ['[itemprop="description"]', '.job-sections'],
  },
  notes: 'Pages carry schema.org microdata, so the microdata strategy usually fills everything.',
});
