import { pathId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'reed',
  name: 'Reed',
  kind: 'job-board',
  regions: ['UK'],
  homepage: 'https://www.reed.co.uk',
  hosts: ['reed.co.uk'],
  externalId: pathId(/\/jobs\/[^/]+\/(\d+)/),
  defaultCurrency: 'GBP',
  selectors: {
    title: ['[data-qa="job-title"]', 'h1'],
    company: ['[data-qa="recruiter-name"]', '[itemprop="hiringOrganization"] [itemprop="name"]'],
    location: ['[data-qa="job-location"]', '[data-qa="localityLbl"]'],
    salary: ['[data-qa="salaryLbl"]', '[data-qa="job-salary"]'],
    employmentType: ['[data-qa="jobTypeLbl"]', '[data-qa="jobTypeMobileLbl"]'],
    description: ['[data-qa="job-description"]', '[itemprop="description"]'],
  },
});
