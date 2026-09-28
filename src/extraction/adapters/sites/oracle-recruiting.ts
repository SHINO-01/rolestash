import { buildUrl } from '../../normalize/url';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'oracle-recruiting',
  name: 'Oracle Recruiting Cloud',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.oracle.com/human-capital-management/recruiting/',
  hosts: [/\.oraclecloud\.com$/],
  externalId: (url) => /\/job\/(\d+)/.exec(url.pathname)?.[1],
  canonicalUrl: (url) => {
    const m = /^(.*\/job\/\d+)/.exec(url.pathname);
    return m?.[1] ? buildUrl(url.hostname, m[1]) : undefined;
  },
  selectors: {
    title: ['.job-details__title', '.job-details h1', 'h1'],
    location: ['.job-details__subtitle', '.job-meta__subitem'],
    description: ['.job-details__description-content', '.job-details__description'],
  },
  selectorConfidence: 0.75,
  notes:
    'Candidate Experience pages under /hcmUI/CandidateExperience/…/job/{id}. Knockout.js SPA — capture after load.',
});
