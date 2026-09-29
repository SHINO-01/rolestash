import { findAdapterByHost, SITE_ADAPTERS } from '@/extraction';
import { resolveAdapter } from '@/extraction/adapters/registry';
import type { ExtractionContext } from '@/extraction';
import { htmlDoc } from '../helpers/dom';

/**
 * URL shapes per adapter: which posting id, company and canonical URL each
 * real-world URL format yields. When a site changes its URL scheme, add a row.
 */
interface UrlCase {
  url: string;
  id?: string | undefined;
  company?: string | undefined;
  canonical?: string | undefined;
}

const CASES: Record<string, UrlCase[]> = {
  ashby: [
    {
      url: 'https://jobs.ashbyhq.com/acme/2f1c9a3e-4b5d-4c6e-8f70-123456789abc/application',
      id: '2f1c9a3e-4b5d-4c6e-8f70-123456789abc',
      company: 'Acme',
    },
    { url: 'https://jobs.ashbyhq.com/acme', id: undefined, canonical: undefined },
  ],
  bamboohr: [
    {
      url: 'https://acme.bamboohr.com/careers/123?source=aWQ9Mg',
      id: '123',
      company: 'Acme',
      canonical: 'https://acme.bamboohr.com/careers/123',
    },
  ],
  breezy: [
    {
      url: 'https://acme.breezy.hr/p/a1b2c3d4e5f6-software-engineer',
      id: 'a1b2c3d4e5f6',
      company: 'Acme',
    },
  ],
  ethicaljobs: [
    {
      url: 'https://www.ethicaljobs.com.au/members/redcross/community-worker',
      company: 'Redcross',
    },
    { url: 'https://www.ethicaljobs.com.au/jobs', company: undefined },
  ],
  gradconnection: [
    {
      url: 'https://au.gradconnection.com/employers/atlassian/jobs/atlassian-graduate/',
      company: 'Atlassian',
    },
    { url: 'https://au.gradconnection.com/jobs/', company: undefined },
  ],
  himalayas: [
    { url: 'https://himalayas.app/companies/acme-labs/jobs/senior-dev', company: 'Acme Labs' },
    { url: 'https://himalayas.app/jobs', company: undefined },
  ],
  icims: [
    {
      url: 'https://careers-acme.icims.com/jobs/1234/software-engineer/job',
      id: '1234',
      company: 'Acme',
    },
  ],
  jazzhr: [
    {
      url: 'https://acme.applytojob.com/apply/AbC123/Software-Engineer',
      id: 'AbC123',
      company: 'Acme',
      canonical: 'https://acme.applytojob.com/apply/AbC123',
    },
  ],
  jobvite: [
    {
      url: 'https://jobs.jobvite.com/acme/job/oAbC123/apply',
      id: 'oAbC123',
      company: 'Acme',
      canonical: 'https://jobs.jobvite.com/acme/job/oAbC123',
    },
    { url: 'https://jobs.jobvite.com/acme/jobs', canonical: undefined },
  ],
  naukri: [
    {
      url: 'https://www.naukri.com/job-listings-software-engineer-acme-bengaluru-3-to-5-years-150926500123',
      id: '150926500123',
    },
  ],
  pageup: [{ url: 'https://careers.pageuppeople.com/513/cw/en/job/612345/lecturer', id: '612345' }],
  personio: [
    {
      url: 'https://acme.jobs.personio.de/job/1234567?display=en',
      id: '1234567',
      company: 'Acme',
      canonical: 'https://acme.jobs.personio.de/job/1234567',
    },
  ],
  prosple: [
    {
      url: 'https://au.prosple.com/graduate-employers/deloitte-australia/jobs-internships/graduate-program',
      company: 'Deloitte Australia',
    },
    { url: 'https://au.prosple.com/search-jobs', company: undefined },
  ],
  recruitee: [
    {
      url: 'https://acme.recruitee.com/o/backend-developer',
      id: 'backend-developer',
      company: 'Acme',
    },
  ],
  remotive: [
    { url: 'https://remotive.com/remote-jobs/software-dev/senior-engineer-123456', id: '123456' },
  ],
  'remote-ok': [{ url: 'https://remoteok.com/', id: undefined, canonical: undefined }],
  smartrecruiters: [
    {
      url: 'https://jobs.smartrecruiters.com/Visa/744000012345678-product-designer',
      id: '744000012345678',
      company: 'Visa',
    },
    { url: 'https://careers.smartrecruiters.com/Visa', company: undefined },
  ],
  stepstone: [
    {
      url: 'https://www.stepstone.de/stellenangebote--Software-Engineer-Berlin-Acme--12345678-inline.html',
      id: '12345678',
    },
  ],
  taleo: [
    {
      url: 'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345&lang=en&src=JB-100',
      id: '12345',
      company: 'Acme',
      canonical: 'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345&lang=en',
    },
    { url: 'https://acme.taleo.net/careersection/2/jobsearch.ftl', canonical: undefined },
  ],
  teamtailor: [
    { url: 'https://acme.teamtailor.com/jobs/123456-developer', id: '123456', company: 'Acme' },
  ],
  totaljobs: [
    { url: 'https://www.totaljobs.com/job/software-engineer/acme-job12345678', id: '12345678' },
  ],
  wellfound: [
    { url: 'https://wellfound.com/company/acme/jobs/987-dev', id: '987', company: 'Acme' },
    { url: 'https://wellfound.com/jobs', canonical: undefined, company: undefined },
  ],
  workable: [
    { url: 'https://apply.workable.com/acme/j/ABC123/', id: 'ABC123', company: 'Acme' },
    { url: 'https://apply.workable.com/acme/', canonical: undefined },
  ],
  'y-combinator': [
    { url: 'https://www.ycombinator.com/companies/acme/jobs/AbC12-dev', company: 'Acme' },
    { url: 'https://www.workatastartup.com/jobs/12345', id: '12345', company: undefined },
  ],
  ziprecruiter: [
    {
      url: 'https://www.ziprecruiter.com/c/Acme-Corp/Job/Engineer/-in-Sydney?jid=abc123',
      id: 'abc123',
      company: 'Acme Corp',
    },
    { url: 'https://www.ziprecruiter.com/jobs/abc', company: undefined, id: undefined },
  ],
  greenhouse: [
    { url: 'https://boards.greenhouse.io/acme/jobs/55', id: '55', company: 'Acme' },
    {
      url: 'https://boards.greenhouse.io/embed/job_board',
      company: undefined,
      canonical: undefined,
    },
  ],
  workday: [
    {
      url: 'https://acme.wd3.myworkdayjobs.com/External/job/Sydney/Dev_JR-1',
      id: 'JR-1',
      company: 'Acme',
    },
  ],
};

const adapterById = new Map(SITE_ADAPTERS.map((a) => [a.id, a]));

describe.each(Object.entries(CASES))('%s URLs', (id, cases) => {
  const adapter = adapterById.get(id);

  it.each(cases)('$url', (c) => {
    expect(adapter, `unknown adapter ${id}`).toBeDefined();
    const url = new URL(c.url);
    expect(findAdapterByHost(url)?.id).toBe(id);
    if ('id' in c) expect(adapter?.externalId?.(url)).toBe(c.id);
    if ('company' in c) expect(adapter?.companyFromUrl?.(url)).toBe(c.company);
    if ('canonical' in c) expect(adapter?.canonicalUrl?.(url)).toBe(c.canonical);
  });
});

describe('adapter custom logic', () => {
  const ctx = (href: string): ExtractionContext => ({
    doc: htmlDoc('<p></p>'),
    url: new URL(href),
    adapter: undefined,
    now: new Date(),
  });

  it.each(['remote-ok', 'remotive', 'we-work-remotely', 'himalayas'])(
    '%s marks jobs remote',
    (id) => {
      expect(adapterById.get(id)?.extract?.(ctx('https://example.com'))).toEqual({
        workplaceType: 'remote',
      });
    },
  );

  it('LinkedIn reads location and posted date from the top-card line', () => {
    const linkedin = adapterById.get('linkedin');
    const doc = htmlDoc(
      '<div class="job-details-jobs-unified-top-card__primary-description-container">Remote · 1 week ago · 12 applicants</div>',
    );
    const out = linkedin?.extract?.({
      ...ctx('https://linkedin.com'),
      doc,
      now: new Date('2026-09-28T12:00:00'),
    });
    expect(out).toEqual({ location: 'Remote', postedAt: '2026-09-21' });
    expect(linkedin?.extract?.({ ...ctx('https://linkedin.com') })).toEqual({});
  });

  it('Teamtailor is detected on customer domains by its CDN assets', () => {
    const doc = htmlDoc('<link rel="stylesheet" href="https://assets.teamtailor-cdn.com/x.css">');
    expect(resolveAdapter(new URL('https://careers.acme.example/jobs/1'), doc)?.id).toBe(
      'teamtailor',
    );
    expect(
      adapterById
        .get('teamtailor')
        ?.companyFromUrl?.(new URL('https://careers.acme.example/jobs/1')),
    ).toBeUndefined();
  });
});
