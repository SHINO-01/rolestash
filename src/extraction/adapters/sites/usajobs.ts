import { canonicalFromId, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/job\/(\d+)/i);

export default defineAdapter({
  id: 'usajobs',
  name: 'USAJOBS',
  kind: 'government',
  regions: ['US'],
  homepage: 'https://www.usajobs.gov',
  hosts: ['usajobs.gov'],
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/job/{id}'),
  defaultCurrency: 'USD',
  selectors: {
    title: ['.usajobs-joa-banner__title', 'h1'],
    company: ['.usajobs-joa-banner__dept', '.usajobs-joa-banner__agency'],
    location: ['.usajobs-joa-locations__city', '.usajobs-joa-locations__list'],
    salary: ['.usajobs-joa-summary__salary', '[itemprop="baseSalary"]'],
    closesAt: ['.usajobs-joa-summary__dates [itemprop="validThrough"]'],
    description: ['#duties', '.usajobs-joa-section__body'],
  },
  notes: '“Company” is the federal department/agency.',
});
