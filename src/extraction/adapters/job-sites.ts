/**
 * The job sites where the floating widget appears by itself (ADR-0030).
 * These are also the extension's host permissions, so the install prompt
 * lists exactly these sites. Pure data with no imports: wxt.config.ts reads
 * it to build the manifest.
 *
 * Every adapter's hosts are here, except where a host also serves things
 * that aren't job postings (Oracle Cloud and SAP SuccessFactors run whole
 * businesses' HR and finance systems). On those, and on any other site, the
 * toolbar icon opens the widget on request (activeTab).
 * tests/unit/extraction/job-sites.test.ts keeps this list and the adapters
 * in step.
 */
export const JOB_SITE_MATCHES: readonly string[] = [
  // Job boards
  'https://*.linkedin.com/*',
  'https://*.seek.com.au/*',
  'https://*.seek.co.nz/*',
  'https://*.seek.com/*',
  'https://*.indeed.com/*',
  'https://*.indeed.com.au/*',
  'https://*.indeed.co.uk/*',
  'https://*.indeed.ca/*',
  'https://*.indeed.co.nz/*',
  'https://*.indeed.co.in/*',
  'https://*.indeed.de/*',
  'https://*.indeed.fr/*',
  'https://*.indeed.ie/*',
  'https://*.indeed.com.sg/*',
  'https://*.glassdoor.com/*',
  'https://*.glassdoor.com.au/*',
  'https://*.glassdoor.co.uk/*',
  'https://*.glassdoor.ca/*',
  'https://*.glassdoor.co.in/*',
  'https://*.adzuna.com/*',
  'https://*.adzuna.com.au/*',
  'https://*.adzuna.co.uk/*',
  'https://*.adzuna.ca/*',
  'https://*.adzuna.in/*',
  'https://*.jora.com/*',
  'https://*.careerone.com.au/*',
  'https://*.ethicaljobs.com.au/*',
  'https://*.gradconnection.com/*',
  'https://*.prosple.com/*',
  'https://*.apsjobs.gov.au/*',
  'https://*.workforceaustralia.gov.au/*',
  'https://*.jobstreet.com/*',
  'https://*.jobstreet.com.my/*',
  'https://*.jobstreet.com.sg/*',
  'https://*.jobstreet.com.ph/*',
  'https://*.jobstreet.co.id/*',
  'https://*.jobsdb.com/*',
  'https://*.naukri.com/*',
  'https://*.reed.co.uk/*',
  'https://*.totaljobs.com/*',
  'https://*.stepstone.de/*',
  'https://*.stepstone.at/*',
  'https://*.stepstone.be/*',
  'https://*.stepstone.nl/*',
  'https://*.stepstone.co.uk/*',
  'https://*.monster.com/*',
  'https://*.monster.co.uk/*',
  'https://*.monster.ca/*',
  'https://*.monster.de/*',
  'https://*.monster.fr/*',
  'https://*.dice.com/*',
  'https://*.careerbuilder.com/*',
  'https://*.ziprecruiter.com/*',
  'https://*.ziprecruiter.co.uk/*',
  'https://*.ziprecruiter.ca/*',
  'https://*.simplyhired.com/*',
  'https://*.simplyhired.co.uk/*',
  'https://*.simplyhired.ca/*',
  'https://*.simplyhired.com.au/*',
  'https://*.usajobs.gov/*',
  'https://*.builtin.com/*',
  'https://*.builtinnyc.com/*',
  'https://*.builtinsf.com/*',
  'https://*.builtinla.com/*',
  'https://*.builtinchicago.com/*',
  'https://*.builtinaustin.com/*',
  'https://*.builtinboston.com/*',
  'https://*.builtincolorado.com/*',
  'https://*.builtinseattle.com/*',
  'https://*.wellfound.com/*',
  'https://*.angel.co/*',
  'https://*.welcometothejungle.com/*',
  'https://*.otta.com/*',
  'https://*.himalayas.app/*',
  'https://*.remoteok.com/*',
  'https://*.remoteok.io/*',
  'https://*.remotive.com/*',
  'https://*.remotive.io/*',
  'https://*.weworkremotely.com/*',
  'https://*.workatastartup.com/*',
  'https://*.ycombinator.com/*',
  // Applicant tracking systems (company career sites)
  'https://*.greenhouse.io/*',
  'https://*.lever.co/*',
  'https://*.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*',
  'https://*.myworkdaysite.com/*',
  'https://*.smartrecruiters.com/*',
  'https://*.workable.com/*',
  'https://*.bamboohr.com/*',
  'https://*.breezy.hr/*',
  'https://*.applytojob.com/*',
  'https://*.jobvite.com/*',
  'https://*.icims.com/*',
  'https://*.taleo.net/*',
  'https://*.recruitee.com/*',
  'https://*.teamtailor.com/*',
  'https://*.personio.de/*',
  'https://*.personio.com/*',
  'https://*.pageuppeople.com/*',
  'https://*.jobadder.com/*',
];

/** Adapter hosts left out on purpose (see above). */
export const JOB_SITE_EXCLUDED_HOSTS: readonly string[] = [
  'oraclecloud.com',
  'successfactors.com',
  'successfactors.eu',
  'jobs.sap.com',
];

/** Does this URL's host fall under one of the patterns? (`*.x.com` includes x.com.) */
export function isJobSite(href: string, patterns: readonly string[] = JOB_SITE_MATCHES): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return patterns.some((pattern) => {
    const domain = /^https:\/\/\*\.([^/]+)\/\*$/.exec(pattern)?.[1];
    return domain !== undefined && (host === domain || host.endsWith(`.${domain}`));
  });
}
