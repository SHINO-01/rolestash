import { cleanText } from '../../normalize/text';
import { canonicalFromId, currencyFromHost, queryId } from '../helpers';
import { defineAdapter } from '../types';

const jobKey = queryId('jk', 'vjk');

export default defineAdapter({
  id: 'indeed',
  name: 'Indeed',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://www.indeed.com',
  lastVerified: '2026-10-01',
  hosts: [/(^|\.)indeed\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/],
  externalId: jobKey,
  // Search view (`/jobs?q=…&vjk=…`) resolves to the posting.
  canonicalUrl: canonicalFromId(jobKey, '/viewjob?jk={id}'),
  defaultCurrency: currencyFromHost('USD'),
  selectors: {
    title: [
      // 2026 layout (search pane and posting page).
      '[data-testid="vj-job-title"]',
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h1.jobsearch-JobInfoHeader-title',
      '.jobsearch-JobInfoHeader-title',
    ],
    company: [
      '[data-testid="company-info-metadata"] a[href*="/cmp/"]',
      '[data-testid="inlineHeader-companyName"]',
      '[data-company-name="true"]',
      '.jobsearch-CompanyInfoContainer a',
    ],
    location: [
      '[data-testid="inlineHeader-companyLocation"]',
      '[data-testid="job-location"]',
      '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
    ],
    salary: [
      '[role="group"][aria-label="Pay"]',
      '#salaryInfoAndJobType',
      '[data-testid="jobsearch-OtherJobDetailsContainer"]',
    ],
    employmentType: [
      '[role="group"][aria-label="Job type"]',
      '#salaryInfoAndJobType',
      '[data-testid="jobsearch-OtherJobDetailsContainer"]',
    ],
    description: [
      '.simple-job-description-html',
      '#jobDescriptionText',
      '.jobsearch-jobDescriptionText',
    ],
  },
  // 2026 layout: location has no hook, but the compact header reads
  // "Company • Location • Pay" right under the title.
  extract: ({ doc }) => {
    const line = doc.querySelector(
      '[data-testid="vj-job-title-compact"] + div, [data-testid="vj-job-title-compact"] ~ div',
    );
    if (!line) return {};
    const parts = [...line.children]
      .filter((el) => el.tagName !== 'A' && el.getAttribute('aria-hidden') !== 'true')
      .map((el) => cleanText(el.textContent))
      .filter((t) => t && !/\d.*(?:a year|an hour|a month|a week|a day|per )|^\$/i.test(t));
    return parts[0] ? { location: parts[0] } : {};
  },
  titlePatterns: [
    /^(?<title>.+?) - (?<company>[^-]+?) - (?<location>[^-]+?) - Indeed(?:\.[a-z.]+)?$/i,
    /^(?<title>.+?) - (?<location>[^-]+?) - Indeed(?:\.[a-z.]+)?$/i,
  ],
  notes:
    'Indeed does not publish JSON-LD on most views, so selectors carry the load. Country sites live on subdomains (au.indeed.com). The search pane uses `vjk`, the posting page uses `jk`. The 2026 layout uses `vj-job-title`, `company-info-metadata` and labelled Pay / Job type groups; location comes from the compact header. The posting page often shows a verification wall to automated browsers, so the live fixture is the search pane.',
});
