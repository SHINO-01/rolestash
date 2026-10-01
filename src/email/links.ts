import { canonicalizeUrl, tryParseUrl } from '../extraction/normalize/url';
import type { EmailLink } from './html';

/**
 * Links are the strongest signals in a job email: a HackerRank link means an
 * assessment, a Calendly link means "book your interview", and a link to the
 * posting tells us which job it is.
 */

export type LinkKind = 'meeting' | 'scheduler' | 'assessment' | 'posting' | 'other';

interface HostRule {
  host: RegExp;
  path?: RegExp;
}

const MEETING: HostRule[] = [
  { host: /(^|\.)zoom\.us$/, path: /^\/(j|my|w|s)\// },
  { host: /^meet\.google\.com$/, path: /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/ },
  { host: /^teams\.microsoft\.com$/, path: /meetup-join|\/meet\// },
  { host: /^teams\.live\.com$/, path: /^\/meet\// },
  { host: /(^|\.)webex\.com$/, path: /^\/(meet|join|[^/]+\/j\.php|wbxmjs)/ },
  { host: /^whereby\.com$/ },
  { host: /^chime\.aws$/ },
];

const SCHEDULER: HostRule[] = [
  { host: /(^|\.)calendly\.com$/ },
  { host: /(^|\.)goodtime\.io$/ },
  { host: /(^|\.)cal\.com$/ },
  { host: /^calendar\.app\.google$/ },
  { host: /^calendar\.google\.com$/, path: /appointments|schedules/ },
  { host: /^outlook\.office(365)?\.com$/, path: /bookwithme|bookings/ },
  { host: /(^|\.)greenhouse\.io$/, path: /schedul/ },
  { host: /(^|\.)lever\.co$/, path: /schedul|interview/ },
  { host: /(^|\.)ashbyhq\.com$/, path: /schedul|interview/ },
  { host: /(^|\.)modernloop\.io$/ },
  { host: /(^|\.)prelude\.co$/ },
  { host: /(^|\.)paradox\.ai$/ },
];

const ASSESSMENT: HostRule[] = [
  { host: /(^|\.)hackerrank\.com$/, path: /test|tests|assessment|candidate|\/t\// },
  { host: /(^|\.)codility\.com$/ },
  { host: /(^|\.)testgorilla\.com$/ },
  { host: /(^|\.)shl\.com$/ },
  { host: /(^|\.)shlonline\.com$/ },
  { host: /(^|\.)codesignal\.com$/ },
  { host: /(^|\.)hirevue\.com$/ },
  { host: /(^|\.)coderbyte\.com$/ },
  { host: /(^|\.)testdome\.com$/ },
  { host: /(^|\.)mettl\.com$/ },
  { host: /(^|\.)criteriacorp\.com$/ },
  { host: /(^|\.)alooba\.com$/ },
  { host: /(^|\.)pymetrics\.(ai|com)$/ },
];

/** Hosts whose links are postings (recruiting systems and job boards). */
const POSTING: HostRule[] = [
  { host: /(^|\.)greenhouse\.io$/, path: /\/jobs\/\d+|gh_jid|token=/ },
  { host: /^jobs\.(eu\.)?lever\.co$/, path: /^\/[^/]+\/[0-9a-f-]{36}/ },
  { host: /\.myworkdayjobs\.com$/, path: /\/job\// },
  { host: /^(jobs|careers)\.smartrecruiters\.com$/, path: /^\/[^/]+\/\d+/ },
  { host: /^jobs\.ashbyhq\.com$/, path: /^\/[^/]+\/[0-9a-f-]{36}/ },
  { host: /\.icims\.com$/, path: /\/jobs\/\d+/ },
  { host: /(^|\.)seek\.(com\.au|co\.nz|com)$/, path: /\/job\/\d+/ },
  { host: /(^|\.)linkedin\.com$/, path: /\/jobs\/view\/\d+/ },
];

const NOT_POSTING_PATH =
  /unsubscribe|preferences|privacy|terms|help|support|login|signin|sign-in|account|settings|notification|feedback|survey/i;

function matches(url: URL, rules: HostRule[]): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname + url.search;
  return rules.some((r) => r.host.test(host) && (!r.path || r.path.test(path)));
}

export function classifyLink(href: string): LinkKind {
  const url = tryParseUrl(href);
  if (!url || !/^https?:$/.test(url.protocol)) return 'other';
  if (matches(url, MEETING)) return 'meeting';
  if (matches(url, SCHEDULER)) return 'scheduler';
  if (matches(url, ASSESSMENT)) return 'assessment';
  if (NOT_POSTING_PATH.test(url.pathname)) return 'other';
  if (matches(url, POSTING)) return 'posting';
  // A company careers site: /careers/…/123, /jobs/…, /job/…, /positions/…
  if (
    /\/(jobs?|careers?|positions?|vacanc(y|ies)|openings?|requisitions?)\/[^/]*\d/i.test(
      url.pathname,
    )
  )
    return 'posting';
  return 'other';
}

export interface ClassifiedLinks {
  meeting?: string;
  scheduler?: string;
  assessment?: string;
  postings: string[];
}

export function classifyLinks(links: readonly EmailLink[]): ClassifiedLinks {
  const out: ClassifiedLinks = { postings: [] };
  const seen = new Set<string>();
  for (const link of links) {
    if (/unsubscribe|opt out|preferences/i.test(link.text)) continue;
    const kind = classifyLink(link.href);
    if (kind === 'meeting') out.meeting ??= link.href;
    else if (kind === 'scheduler') out.scheduler ??= link.href;
    else if (kind === 'assessment') out.assessment ??= link.href;
    else if (kind === 'posting') {
      const canonical = canonicalizeUrl(link.href);
      if (!seen.has(canonical) && out.postings.length < 10) {
        seen.add(canonical);
        out.postings.push(canonical);
      }
    }
  }
  return out;
}
