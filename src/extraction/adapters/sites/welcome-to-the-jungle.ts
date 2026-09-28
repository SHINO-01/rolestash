import { companyFromPath } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'welcome-to-the-jungle',
  name: 'Welcome to the Jungle (Otta)',
  kind: 'job-board',
  regions: ['EU', 'UK', 'US'],
  homepage: 'https://www.welcometothejungle.com',
  hosts: ['welcometothejungle.com', 'otta.com'],
  // /{lang}/companies/{company}/jobs/{slug}
  companyFromUrl: (url) => {
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[1] === 'companies' ? companyFromPath(url, 2) : undefined;
  },
  selectors: {
    title: ['[data-testid="job-metadata-block"] h2', 'h1'],
    description: ['[data-testid="job-section-description"]', '#the-position-section'],
  },
  notes: 'Otta merged into Welcome to the Jungle; app.welcometothejungle.com requires login.',
});
