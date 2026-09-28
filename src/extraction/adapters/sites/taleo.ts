import { companyFromSubdomain, keepParams, queryId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'taleo',
  name: 'Oracle Taleo',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.oracle.com/human-capital-management/taleo/',
  hosts: ['taleo.net'],
  externalId: queryId('job'),
  canonicalUrl: (url) => (url.searchParams.has('job') ? keepParams('job', 'lang')(url) : undefined),
  companyFromUrl: (url) => companyFromSubdomain(url, ['www', 'chp', 'tbe', 'career', 'careers']),
  selectors: {
    title: ['[id$="reqTitleLinkAction.row1"]', '.titlepage', 'h1'],
    location: ['[id$="reqBasicLocation.row1"]', '[id$="reqLocation.row1"]'],
    postedAt: ['[id$="reqPostingDate.row1"]'],
    closesAt: ['[id$="reqUnpostingDate.row1"]'],
    description: ['[id$="ID1558.row1"]', '.editablesection', '.contentlinepanel'],
  },
  selectorConfidence: 0.7,
  notes:
    'Legacy platform with generated element ids; selectors match id suffixes. Being replaced by Oracle Recruiting Cloud (see `oracle-recruiting`).',
});
