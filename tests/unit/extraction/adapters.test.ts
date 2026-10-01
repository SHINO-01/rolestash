import { findAdapterByHost, resolveAdapter, SITE_ADAPTERS } from '@/extraction';
import { hostMatches } from '@/extraction/adapters/registry';
import { companyFromSubdomain, currencyFromHost } from '@/extraction/adapters/helpers';
import { htmlDoc } from '../helpers/dom';

describe('adapter registry', () => {
  it('ships 50 adapters', () => {
    expect(SITE_ADAPTERS).toHaveLength(50);
  });

  it('has unique, kebab-case ids and names', () => {
    const ids = SITE_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(SITE_ADAPTERS.map((a) => a.name)).size).toBe(ids.length);
  });

  it.each(SITE_ADAPTERS.map((a) => [a.id, a] as const))(
    '%s is well-formed and owns its homepage',
    (_id, adapter) => {
      expect(adapter.hosts.length).toBeGreaterThan(0);
      expect(adapter.homepage).toMatch(/^https:\/\//);
      expect(adapter.regions.length).toBeGreaterThan(0);
      if (adapter.selectorConfidence !== undefined) {
        expect(adapter.selectorConfidence).toBeGreaterThan(0);
        expect(adapter.selectorConfidence).toBeLessThan(0.95); // must stay below JSON-LD
      }
      // Every selector must be valid CSS (after stripping an @attr suffix).
      for (const selectors of Object.values(adapter.selectors ?? {})) {
        for (const selector of selectors) {
          const css = selector.replace(/@[a-z][\w-]*$/i, '');
          expect(() => document.querySelector(css), `${adapter.id}: ${selector}`).not.toThrow();
        }
      }
      // Title patterns must be able to produce something useful.
      for (const re of adapter.titlePatterns ?? [])
        expect(re.source).toMatch(/\(\?<(title|company)>/);
    },
  );

  it('matches hosts by domain suffix, not substring', () => {
    expect(hostMatches('au.linkedin.com', 'linkedin.com')).toBe(true);
    expect(hostMatches('linkedin.com', 'linkedin.com')).toBe(true);
    expect(hostMatches('notlinkedin.com', 'linkedin.com')).toBe(false);
  });

  it.each([
    ['https://www.linkedin.com/jobs/view/123456789', 'linkedin'],
    ['https://uk.indeed.com/viewjob?jk=1', 'indeed'],
    ['https://www.indeed.co.uk/viewjob?jk=1', 'indeed'],
    ['https://www.seek.co.nz/job/1', 'seek'],
    ['https://au.seek.com/job/1', 'seek'],
    ['https://nz.seek.com/job/1', 'seek'],
    ['https://my.jobstreet.com/job/1', 'jobstreet'],
    ['https://hk.jobsdb.com/job/1', 'jobstreet'],
    ['https://acme.wd3.myworkdayjobs.com/External/job/X_R1', 'workday'],
    ['https://careers-acme.icims.com/jobs/1/job', 'icims'],
    ['https://jobs.eu.lever.co/acme/x', 'lever'],
    ['https://job-boards.eu.greenhouse.io/acme/jobs/1', 'greenhouse'],
    ['https://acme.jobs.personio.de/job/1', 'personio'],
    [
      'https://ssc.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1',
      'oracle-recruiting',
    ],
    ['https://www.ycombinator.com/companies/acme/jobs/abc-dev', 'y-combinator'],
    ['https://www.stepstone.de/stellenangebote--Dev--123-inline.html', 'stepstone'],
  ])('%s → %s', (url, id) => {
    expect(findAdapterByHost(new URL(url))?.id).toBe(id);
  });

  it('detects white-labelled platforms by DOM fingerprint only when no host matches', () => {
    const doc = htmlDoc('<div data-careersite-propertyid="title">Dev</div>');
    expect(resolveAdapter(new URL('https://jobs.bigcorp.example/job/1'), doc)?.id).toBe(
      'successfactors',
    );
    expect(resolveAdapter(new URL('https://www.seek.com.au/job/1'), doc)?.id).toBe('seek');
    expect(resolveAdapter(new URL('https://example.com'), htmlDoc('<p>hi</p>'))).toBeUndefined();
  });
});

describe('canonical URLs', () => {
  const canon = (href: string) => {
    const url = new URL(href);
    return findAdapterByHost(url)?.canonicalUrl?.(url);
  };

  it.each([
    [
      'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4000000001',
      'https://linkedin.com/jobs/view/4000000001',
    ],
    [
      'https://www.linkedin.com/jobs/view/senior-dev-at-acme-4000000002/?trackingId=x',
      'https://linkedin.com/jobs/view/4000000002',
    ],
    ['https://au.indeed.com/jobs?q=dev&vjk=abc123', 'https://au.indeed.com/viewjob?jk=abc123'],
    ['https://www.seek.com.au/dev-jobs?jobId=77', 'https://au.seek.com/job/77'],
    [
      'https://au.seek.com/job/94604943?type=promoted&ref=search-standalone',
      'https://au.seek.com/job/94604943',
    ],
    ['https://www.seek.co.nz/job/5', 'https://nz.seek.com/job/5'],
    [
      'https://boards.greenhouse.io/embed/job_app?for=acme&token=55',
      'https://boards.greenhouse.io/acme/jobs/55',
    ],
    [
      'https://jobs.lever.co/acme/2f1c9a3e-4b5d-4c6e-8f70-123456789abc/apply',
      'https://jobs.lever.co/acme/2f1c9a3e-4b5d-4c6e-8f70-123456789abc',
    ],
    [
      'https://jobs.ashbyhq.com/acme/2f1c9a3e-4b5d-4c6e-8f70-123456789abc/application',
      'https://jobs.ashbyhq.com/acme/2f1c9a3e-4b5d-4c6e-8f70-123456789abc',
    ],
    [
      'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Sydney/Dev_JR-1/apply/autofillWithResume',
      'https://acme.wd3.myworkdayjobs.com/Careers/job/Sydney/Dev_JR-1',
    ],
    [
      'https://careers-acme.icims.com/jobs/1234/software-engineer/job?in_iframe=1&hub=7',
      'https://careers-acme.icims.com/jobs/1234/job',
    ],
    ['https://apply.workable.com/acme/j/ABC123/apply/', 'https://apply.workable.com/acme/j/ABC123'],
    [
      'https://remoteok.com/remote-jobs/remote-dev-acme-123456',
      'https://remoteok.com/remote-jobs/123456',
    ],
    ['https://angel.co/company/acme/jobs/987-dev', 'https://wellfound.com/jobs/987'],
  ])('%s', (input, expected) => {
    expect(canon(input)).toBe(expected);
  });
});

describe('helpers', () => {
  it('derives company from subdomains', () => {
    expect(companyFromSubdomain(new URL('https://careers-acme-corp.icims.com'))).toBe('Acme Corp');
    expect(companyFromSubdomain(new URL('https://www.bamboohr.com'))).toBeUndefined();
  });

  it('derives currency from host', () => {
    const c = currencyFromHost('USD');
    expect(c(new URL('https://au.indeed.com'))).toBe('AUD');
    expect(c(new URL('https://www.seek.co.nz'))).toBe('NZD');
    expect(c(new URL('https://www.indeed.com'))).toBe('USD');
  });
});
