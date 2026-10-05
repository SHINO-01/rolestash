import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlatformDomain } from '@/email';

/**
 * The server refuses company votes for the same domains the extension skips
 * (ADR-0028). private.is_platform_domain() repeats isPlatformDomain()'s
 * patterns in SQL; this keeps the two in step.
 */
const MIGRATION = join(
  import.meta.dirname,
  '../../../supabase/migrations/20261019120000_knowledge_hardening.sql',
);

function sqlPatterns(): RegExp[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const fn = sql.slice(sql.indexOf('create function private.is_platform_domain'));
  const body = fn.slice(0, fn.indexOf('$$;', fn.indexOf('$$') + 2));
  return [...body.matchAll(/p_domain ~ '([^']+)'/g)].map((m) => new RegExp(m[1] ?? ''));
}

const DOMAINS = [
  // Recruiting systems and job sites
  'greenhouse.io',
  'us.greenhouse-mail.io',
  'hire.lever.co',
  'myworkday.com',
  'acme.wd5.myworkdayjobs.com',
  'smartrecruiters.com',
  'smartrecruitersmail.com',
  'ashbyhq.com',
  'careers.icims.com',
  'seek.com.au',
  'seek.co.nz',
  'linkedin.com',
  'e.linkedin.com',
  'indeed.com',
  'indeedemail.com',
  'jobadder.com',
  'pageuppeople.com',
  'bamboohr.com',
  'workable.com',
  'jobvite.com',
  'teamtailor.com',
  'recruitee.com',
  'breezy.hr',
  'jazzhr.com',
  'successfactors.com',
  'taleo.net',
  'oraclecloud.com',
  // Mail platforms
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'sendgrid.net',
  'mailgun.org',
  'mailgun.net',
  'mandrillapp.com',
  'amazonses.com',
  // Companies
  'northwindlabs.example',
  'quokka.health',
  'notgreenhouse.io',
  'greenhouse.io.example',
  'mylinkedin.com.au',
  'acme.com',
  'jobs.atlassian.com',
];

describe('platform domains (ADR-0028)', () => {
  it('the server refuses exactly the domains the extension skips', () => {
    const patterns = sqlPatterns();
    expect(patterns).toHaveLength(2);
    for (const domain of DOMAINS)
      expect(
        patterns.some((re) => re.test(domain)),
        domain,
      ).toBe(isPlatformDomain(domain));
    expect(DOMAINS.filter(isPlatformDomain).length).toBeGreaterThan(30);
  });
});
