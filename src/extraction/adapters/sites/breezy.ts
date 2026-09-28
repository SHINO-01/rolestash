import { companyFromSubdomain } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'breezy',
  name: 'Breezy HR',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://breezy.hr',
  hosts: ['breezy.hr'],
  externalId: (url) => /\/p\/([a-z0-9]+)/i.exec(url.pathname)?.[1],
  companyFromUrl: (url) => companyFromSubdomain(url),
  selectors: {
    title: ['.position h1', '.banner h1', 'h1'],
    location: ['.position .location', 'li.location span'],
    employmentType: ['.position .type', 'li.type span'],
    description: ['.description'],
  },
});
