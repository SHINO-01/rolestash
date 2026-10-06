import { SITE_ADAPTERS } from '@/extraction/adapters/registry';
import {
  isJobSite,
  JOB_SITE_EXCLUDED_HOSTS,
  JOB_SITE_MATCHES,
} from '@/extraction/adapters/job-sites';

/** A real host for each adapter whose hosts are patterns, not plain domains. */
const SAMPLES: Record<string, string[]> = {
  'built-in': ['builtin.com', 'www.builtinnyc.com'],
  adzuna: ['www.adzuna.com.au', 'www.adzuna.co.uk'],
  glassdoor: ['www.glassdoor.com.au', 'www.glassdoor.com'],
  indeed: ['au.indeed.com', 'www.indeed.com', 'uk.indeed.com', 'www.indeed.co.uk'],
  personio: ['acme.jobs.personio.de', 'acme.jobs.personio.com'],
  pageup: ['careers.pageuppeople.com'],
  monster: ['www.monster.com', 'www.monster.co.uk'],
  jobstreet: ['www.jobstreet.com.my', 'id.jobstreet.com'],
  ziprecruiter: ['www.ziprecruiter.com'],
  simplyhired: ['www.simplyhired.com.au'],
  stepstone: ['www.stepstone.de'],
  workday: ['acme.wd3.myworkdayjobs.com', 'acme.wd1.myworkdaysite.com'],
};

describe('job sites for the floating widget (ADR-0030)', () => {
  it('covers every adapter host, apart from the ones left out on purpose', () => {
    for (const adapter of SITE_ADAPTERS)
      for (const host of adapter.hosts) {
        if (typeof host === 'string') {
          if (JOB_SITE_EXCLUDED_HOSTS.includes(host)) continue;
          expect(isJobSite(`https://www.${host}/jobs/1`), `${adapter.id}: ${host}`).toBe(true);
          expect(isJobSite(`https://${host}/jobs/1`), `${adapter.id}: ${host}`).toBe(true);
        } else if (
          !JOB_SITE_EXCLUDED_HOSTS.some((h) => host.test(h) || host.test(`careers.${h}`))
        ) {
          const samples = SAMPLES[adapter.id];
          expect(samples, `add a SAMPLES entry for ${adapter.id}`).toBeDefined();
          const matching = (samples ?? []).filter((sample) => host.test(sample));
          expect(matching.length, `${adapter.id}: a sample for ${String(host)}`).toBeGreaterThan(0);
          for (const sample of matching)
            expect(isJobSite(`https://${sample}/`), `${adapter.id}: ${sample}`).toBe(true);
        }
      }
  });

  it('is a list of plain https domain patterns, with no catch-alls', () => {
    for (const pattern of JOB_SITE_MATCHES)
      expect(pattern).toMatch(/^https:\/\/\*\.[a-z0-9.-]+\.[a-z]+\/\*$/);
    expect(new Set(JOB_SITE_MATCHES).size).toBe(JOB_SITE_MATCHES.length);
  });

  it('matches hosts, not look-alikes', () => {
    expect(isJobSite('https://www.linkedin.com/jobs/view/1')).toBe(true);
    expect(isJobSite('https://linkedin.com.evil.example/jobs')).toBe(false);
    expect(isJobSite('https://notlinkedin.com/')).toBe(false);
    expect(isJobSite('http://www.linkedin.com/')).toBe(false);
    expect(isJobSite('https://acme.oraclecloud.com/hcmUI/')).toBe(false);
    expect(isJobSite('not a url')).toBe(false);
  });
});
