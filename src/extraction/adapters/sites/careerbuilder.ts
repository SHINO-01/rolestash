import { pathId } from '../helpers';
import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'careerbuilder',
  name: 'CareerBuilder',
  kind: 'job-board',
  regions: ['US'],
  homepage: 'https://www.careerbuilder.com',
  hosts: ['careerbuilder.com'],
  externalId: pathId(/\/job\/([A-Za-z0-9]+)/),
  defaultCurrency: 'USD',
  selectors: {
    title: ['.jdp_title_header', 'h1'],
    company: ['.data-details span:first-child', '.jdp-company'],
    location: ['.data-details span:nth-child(2)', '.jdp-location'],
    description: ['#jdp_description', '.jdp-description-details'],
  },
});
