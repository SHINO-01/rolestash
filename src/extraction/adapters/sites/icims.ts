import { buildUrl } from '../../normalize/url';
import { companyFromSubdomain } from '../helpers';
import { defineAdapter } from '../types';

const id = (url: URL): string | undefined => /\/jobs\/(\d+)/.exec(url.pathname)?.[1];

export default defineAdapter({
  id: 'icims',
  name: 'iCIMS',
  kind: 'ats',
  regions: ['global', 'US'],
  homepage: 'https://www.icims.com',
  hosts: ['icims.com'],
  externalId: id,
  canonicalUrl: (url) => {
    const jobId = id(url);
    return jobId ? buildUrl(url.hostname, `/jobs/${jobId}/job`) : undefined;
  },
  // careers-acme.icims.com → "Acme"
  companyFromUrl: (url) => companyFromSubdomain(url),
  selectors: {
    title: ['.iCIMS_Header h1', 'h1.iCIMS_Header', '.iCIMS_JobHeaderTitle', 'h1'],
    location: ['.iCIMS_JobHeaderGroup .header.left span:last-child', '.iCIMS_JobHeaderData'],
    description: ['.iCIMS_JobContent', '.iCIMS_InfoMsg_Job'],
  },
  selectorConfidence: 0.75,
  notes:
    'The posting renders inside a same-origin iframe (`?in_iframe=1`). The extractor runs in every frame and keeps the best result, so this works without extra permissions.',
});
