import { companyFromSubdomain } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'teamtailor',
  name: 'Teamtailor',
  kind: 'ats',
  regions: ['EU', 'global'],
  homepage: 'https://www.teamtailor.com',
  hosts: ['teamtailor.com'],
  detect: (doc) =>
    doc.querySelector(
      'link[href*="teamtailor-cdn"], script[src*="teamtailor-cdn"], img[src*="teamtailor-cdn"]',
    ) !== null,
  externalId: (url) => /\/jobs\/(\d+)/.exec(url.pathname)?.[1],
  companyFromUrl: (url) =>
    url.hostname.endsWith('teamtailor.com') ? companyFromSubdomain(url) : undefined,
  selectors: {
    title: ['h1'],
    description: ['[data-controller*="job-ad"]', '.prose'],
  },
  notes:
    'Frequently served on customer domains (careers.acme.com); detected via Teamtailor CDN assets.',
});
