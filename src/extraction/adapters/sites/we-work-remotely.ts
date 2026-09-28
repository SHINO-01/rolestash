import { defineAdapter } from '../types';

export default defineAdapter({
  id: 'we-work-remotely',
  name: 'We Work Remotely',
  kind: 'job-board',
  regions: ['global'],
  homepage: 'https://weworkremotely.com',
  hosts: ['weworkremotely.com'],
  defaultCurrency: 'USD',
  extract: () => ({ workplaceType: 'remote' }),
  selectors: {
    title: ['.listing-header-container h1', '.lis-container__header__hero__company-info h1', 'h1'],
    company: ['.company-card h2', '.lis-container__job__sidebar__companyDetails__info__title h3'],
    location: ['.company-card h3', '.lis-container__job__sidebar__job-about__list__item span'],
    description: ['.listing-container', '.lis-container__job__content__description'],
  },
});
