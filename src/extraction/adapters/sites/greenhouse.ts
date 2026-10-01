import { buildUrl } from '../../normalize/url';
import { slugToName } from '../../normalize/text';
import { defineAdapter } from '../types';

const RESERVED = new Set(['embed', 'v1', 'boards']);

const companySlug = (url: URL): string | undefined => {
  const forParam = url.searchParams.get('for');
  if (forParam) return forParam;
  const first = url.pathname.split('/').find(Boolean);
  return first && !RESERVED.has(first) ? first : undefined;
};
const jobId = (url: URL): string | undefined =>
  /\/jobs\/(\d+)/.exec(url.pathname)?.[1] ??
  url.searchParams.get('token') ??
  url.searchParams.get('gh_jid') ??
  undefined;

export default defineAdapter({
  id: 'greenhouse',
  name: 'Greenhouse',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.greenhouse.com',
  lastVerified: '2026-10-01',
  hosts: ['greenhouse.io'],
  externalId: jobId,
  // Embed URLs (`/embed/job_app?for=acme&token=123`) resolve to the hosted board URL.
  canonicalUrl: (url) => {
    const slug = companySlug(url);
    const id = jobId(url);
    return slug && id ? buildUrl(url.hostname, `/${slug}/jobs/${id}`) : undefined;
  },
  companyFromUrl: (url) => {
    const slug = companySlug(url);
    return slug ? slugToName(slug) : undefined;
  },
  selectors: {
    title: ['.job__title h1', 'h1.section-header', '.app-title', 'h1'],
    company: ['.company-name'],
    location: ['.job__location', '.location'],
    description: ['.job__description', '#content', '.job-post-content'],
  },
  // "Job Application for AI Engineer at GitLab": the real company name, not the URL slug.
  titlePatterns: [/^Job Application for (?<title>.+) at (?<company>[^|]+?)$/i],
  notes:
    'Hosted boards live on boards.greenhouse.io and job-boards.greenhouse.io. Since 2026 the job-boards pages carry no JSON-LD, so selectors carry the load; the page title gives the company’s real name. Company career pages often embed Greenhouse in a cross-origin iframe, which the `activeTab` permission cannot read — open the posting on greenhouse.io to capture it.',
});
