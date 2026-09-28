import { canonicalFromId, currencyFromHost, queryId } from '../helpers';
import { defineAdapter } from '../types';

const jobKey = queryId('jk', 'vjk');

export default defineAdapter({
  id: 'indeed',
  name: 'Indeed',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://www.indeed.com',
  hosts: [/(^|\.)indeed\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/],
  externalId: jobKey,
  // Search view (`/jobs?q=…&vjk=…`) resolves to the posting.
  canonicalUrl: canonicalFromId(jobKey, '/viewjob?jk={id}'),
  defaultCurrency: currencyFromHost('USD'),
  selectors: {
    title: [
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h1.jobsearch-JobInfoHeader-title',
      '.jobsearch-JobInfoHeader-title',
    ],
    company: [
      '[data-testid="inlineHeader-companyName"]',
      '[data-company-name="true"]',
      '.jobsearch-CompanyInfoContainer a',
    ],
    location: [
      '[data-testid="inlineHeader-companyLocation"]',
      '[data-testid="job-location"]',
      '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
    ],
    salary: ['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]'],
    employmentType: ['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]'],
    description: ['#jobDescriptionText', '.jobsearch-jobDescriptionText'],
  },
  titlePatterns: [
    /^(?<title>.+?) - (?<company>[^-]+?) - (?<location>[^-]+?) - Indeed(?:\.[a-z.]+)?$/i,
    /^(?<title>.+?) - (?<location>[^-]+?) - Indeed(?:\.[a-z.]+)?$/i,
  ],
  notes:
    'Indeed does not publish JSON-LD on most views, so selectors carry the load. Country sites live on subdomains (au.indeed.com). The search pane uses `vjk`, the posting page uses `jk`.',
});
