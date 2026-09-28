import { companyFromPath, currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'gradconnection',
  name: 'GradConnection',
  kind: 'job-board',
  regions: ['AU', 'NZ', 'SEA'],
  homepage: 'https://au.gradconnection.com',
  hosts: ['gradconnection.com'],
  defaultCurrency: currencyFromHost('AUD'),
  // /employers/{company}/jobs/{slug}
  companyFromUrl: (url) =>
    url.pathname.startsWith('/employers/') ? companyFromPath(url, 1) : undefined,
  selectors: {
    title: ['.employers-profile-h1', 'h1'],
    company: ['.employers-panel-title', '.employer-name'],
    location: ['.box-content-location', '.location'],
    closesAt: ['.box-closing-date', '.closing-date'],
    description: ['.campaign-content-container', '.job-description'],
  },
  notes: 'Graduate and internship roles. Company is also derivable from the URL path.',
});
