import { companyFromPath, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/jobs\/(\d+)/);

export default defineAdapter({
  id: 'wellfound',
  name: 'Wellfound',
  kind: 'job-board',
  regions: ['global', 'US'],
  homepage: 'https://wellfound.com',
  hosts: ['wellfound.com', 'angel.co'],
  externalId: id,
  canonicalUrl: (url) => {
    const jobId = id(url);
    return jobId ? `https://wellfound.com/jobs/${jobId}` : undefined;
  },
  // /company/{slug}/jobs/{id}-{title}
  companyFromUrl: (url) =>
    url.pathname.startsWith('/company/') ? companyFromPath(url, 1) : undefined,
  selectors: {
    title: ['h1'],
    description: ['[data-test="JobDescription"]', '[class*="description"]'],
  },
  titlePatterns: [/^(?<title>.+?) at (?<company>.+?) • .*$/i],
  notes:
    'Startup jobs (formerly AngelList Talent). Next.js; JSON-LD is the primary source. Some postings require login.',
});
