import { currencyFromHost, keepParams, queryId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'glassdoor',
  name: 'Glassdoor',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://www.glassdoor.com',
  hosts: [/(^|\.)glassdoor\.[a-z.]+$/],
  externalId: queryId('jl', 'jobListingId'),
  canonicalUrl: (url) => (url.searchParams.has('jl') ? keepParams('jl')(url) : undefined),
  defaultCurrency: currencyFromHost('USD'),
  selectors: {
    title: ['[data-test="job-title"]', '[id^="jd-job-title"]'],
    company: [
      '[data-test="employer-name"]',
      '[class*="EmployerProfile_employerName"]',
      '[class*="EmployerProfile_compactEmployerName"]',
    ],
    location: ['[data-test="location"]'],
    salary: ['[data-test="detailSalary"]', '[class*="SalaryEstimate_salaryRange"]'],
    description: [
      '[class*="JobDetails_jobDescription"]',
      '.jobDescriptionContent',
      '#JobDescriptionContainer',
    ],
  },
  notes:
    'Class names are CSS-module hashes, so selectors match on stable prefixes (`[class*="JobDetails_"]`). Employer names include the star rating, which the pipeline strips. Dedupe relies on the `jl` id.',
});
