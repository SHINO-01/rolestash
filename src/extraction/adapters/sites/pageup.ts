import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'pageup',
  name: 'PageUp',
  kind: 'ats',
  regions: ['AU', 'global'],
  homepage: 'https://www.pageuppeople.com',
  hosts: [/\.pageuppeople\.com$/],
  externalId: (url) => /\/job\/(\d+)/.exec(url.pathname)?.[1],
  defaultCurrency: 'AUD',
  selectors: {
    title: ['#job-content h2', '.job-title', 'h1'],
    location: ['#job-content .location', '.location'],
    employmentType: ['#job-content .work-type', '.work-type'],
    closesAt: ['#job-content .close-date', '.close-date'],
    description: ['#job-details', '.job-description', '#job-content'],
  },
  selectorConfidence: 0.75,
  notes: 'Widely used by Australian universities and government agencies.',
});
