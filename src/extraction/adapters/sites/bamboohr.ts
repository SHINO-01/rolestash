import { canonicalFromId, companyFromSubdomain, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/careers\/(\d+)/);

export default defineAdapter({
  id: 'bamboohr',
  name: 'BambooHR',
  kind: 'ats',
  regions: ['global'],
  homepage: 'https://www.bamboohr.com',
  hosts: ['bamboohr.com'],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/careers/{id}'),
  companyFromUrl: (url) => companyFromSubdomain(url),
  selectors: {
    title: ['.fab-Text--biggie', '.ResAts__card-title', 'h2'],
    location: ['.ResAts__card-subtitle', '[class*="Location"]'],
    description: ['.BambooRichText', '.ResAts__card-content'],
  },
  selectorConfidence: 0.65,
  notes: 'acme.bamboohr.com/careers/{id}. Heavily client-rendered; JSON-LD preferred.',
});
