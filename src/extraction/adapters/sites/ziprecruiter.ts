import { companyFromPath, currencyFromHost } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'ziprecruiter',
  name: 'ZipRecruiter',
  kind: 'job-board',
  regions: ['US', 'UK'],
  homepage: 'https://www.ziprecruiter.com',
  hosts: [/(^|\.)ziprecruiter\.(com|co\.uk|ca)$/],
  defaultCurrency: currencyFromHost('USD'),
  // /c/{Company}/Job/{Title}/-in-{Location}?jid=…
  companyFromUrl: (url) => (url.pathname.startsWith('/c/') ? companyFromPath(url, 1) : undefined),
  externalId: (url) => url.searchParams.get('jid') ?? undefined,
  selectors: {
    title: ['h1.job_title', '.job_header h1', 'h1'],
    company: ['.hiring_company_text a', '.hiring_company', '[data-testid="job-details-company"]'],
    location: ['.location_text', '.job_location', '[data-testid="job-details-location"]'],
    salary: ['.job_salary', '[data-testid="job-details-salary"]'],
    description: ['.job_description', '.jobDescriptionSection', '[data-testid="job-description"]'],
  },
});
