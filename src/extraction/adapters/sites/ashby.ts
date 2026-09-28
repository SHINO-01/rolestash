import { buildUrl } from '../../normalize/url';
import { companyFromPath, TITLE_AT_COMPANY } from '../helpers';
import { defineAdapter } from '../types';

const UUID = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export default defineAdapter({
  id: 'ashby',
  name: 'Ashby',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.ashbyhq.com',
  hosts: ['ashbyhq.com'],
  externalId: (url) => UUID.exec(url.pathname)?.[1],
  canonicalUrl: (url) => {
    const id = UUID.exec(url.pathname)?.[1];
    const company = url.pathname.split('/').find(Boolean);
    return id && company ? buildUrl(url.hostname, `/${company}/${id}`) : undefined;
  },
  companyFromUrl: (url) => companyFromPath(url, 0),
  selectors: {
    title: ['[class*="_titles_"] h1', 'h1'],
    description: ['[class*="_descriptionText_"]', '[class*="_description_"]'],
  },
  titlePatterns: [TITLE_AT_COMPANY],
  notes:
    'React SPA with hashed class names; JSON-LD is the reliable source. `/application` suffix is stripped for dedupe.',
});
