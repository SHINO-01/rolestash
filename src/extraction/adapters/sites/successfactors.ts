import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'successfactors',
  name: 'SAP SuccessFactors',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.sap.com/products/hcm/recruiting-software.html',
  hosts: [/\.successfactors\.(com|eu)$/, 'jobs.sap.com'],
  // Recruiting Marketing (RMK) sites run on customer domains.
  detect: (doc) => doc.querySelector('[data-careersite-propertyid]') !== null,
  selectors: {
    title: ['[data-careersite-propertyid="title"]', '#job-title', '.jobTitle', 'h1'],
    location: [
      '[data-careersite-propertyid="location"]',
      '[data-careersite-propertyid="city"]',
      '.jobGeoLocation',
    ],
    postedAt: ['[data-careersite-propertyid="date"]'],
    description: [
      '[data-careersite-propertyid="description"]',
      '.jobdescription',
      '.joqReqDescription',
    ],
  },
  notes:
    'RMK career sites expose `data-careersite-propertyid` hooks plus microdata; company usually comes from JSON-LD/og:site_name.',
});
