import { defineAdapter } from '../types';

const id = (url: URL): string | undefined =>
  /\/remote-jobs\/(?:.*-)?(\d+)$/.exec(url.pathname)?.[1];

export default defineAdapter({
  id: 'remote-ok',
  name: 'Remote OK',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://remoteok.com',
  hosts: ['remoteok.com', 'remoteok.io'],
  externalId: id,
  canonicalUrl: (url) => {
    const jobId = id(url);
    return jobId ? `https://remoteok.com/remote-jobs/${jobId}` : undefined;
  },
  defaultCurrency: 'USD',
  extract: () => ({ workplaceType: 'remote' }),
  selectors: {
    title: ['.company_and_position h2', '[itemprop="title"]'],
    company: ['.company_and_position h3', '[itemprop="hiringOrganization"]'],
    description: ['.description', '.markdown'],
  },
});
