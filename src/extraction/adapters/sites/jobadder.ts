import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'jobadder',
  name: 'JobAdder',
  kind: 'ats',
  regions: ['AU', 'NZ', 'UK'],
  homepage: 'https://jobadder.com',
  hosts: ['jobadder.com'],
  defaultCurrency: 'AUD',
  selectors: {
    title: ['.job-title', 'h1'],
    location: ['.job-location', '.location'],
    salary: ['.job-salary', '.salary'],
    description: ['.job-description', '.description'],
  },
  selectorConfidence: 0.7,
  notes:
    'Recruitment-agency ATS popular in AU/NZ. Boards are usually embedded in agency sites; open the job on jobadder.com to capture it.',
});
