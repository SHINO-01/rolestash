import { buildUrl } from '../../normalize/url';
import { companyFromSubdomain } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'workday',
  name: 'Workday',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.workday.com',
  hosts: [/\.myworkdayjobs\.com$/, /\.myworkdaysite\.com$/],
  // Many enterprises serve Workday on their own domain.
  detect: (doc) => doc.querySelector('[data-automation-id="jobPostingHeader"]') !== null,
  externalId: (url) => /_([A-Za-z]*[-_]?\d[\w-]*)(?:\/apply.*)?$/.exec(url.pathname)?.[1],
  // Strip locale prefix and `/apply…` suffix so all views of one posting dedupe.
  canonicalUrl: (url) => {
    const path = url.pathname
      .replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, '')
      .replace(/\/apply(\/.*)?$/, '');
    return buildUrl(url.hostname, path);
  },
  companyFromUrl: (url) =>
    /myworkday(jobs|site)\.com$/.test(url.hostname) ? companyFromSubdomain(url) : undefined,
  selectors: {
    title: ['[data-automation-id="jobPostingHeader"]'],
    location: ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]'],
    employmentType: ['[data-automation-id="time"] dd', '[data-automation-id="time"]'],
    postedAt: ['[data-automation-id="postedOn"] dd', '[data-automation-id="postedOn"]'],
    description: ['[data-automation-id="jobPostingDescription"]'],
  },
  selectorConfidence: 0.9,
  notes:
    '`data-automation-id` hooks are stable across tenants. Company comes from the tenant subdomain (acme.wd3.myworkdayjobs.com) or JSON-LD. Capture after the SPA finishes loading.',
});
