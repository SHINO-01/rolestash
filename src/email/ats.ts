import { tryParseUrl } from '../extraction/normalize/url';
import type { AtsId, StatusIntent } from './constants';

/**
 * Template readers, one per recruiting system (ADR-0014 §5). Templated
 * emails are read exactly: system notifications (LinkedIn "your application
 * was sent", SEEK "application submitted", job alerts) decide the intent;
 * other templates add strong evidence and give the company, title and job id.
 */

export interface TemplateContext {
  ats?: AtsId;
  subject: string;
  body: string;
  senderName?: string;
  postingUrls: readonly string[];
}

export interface TemplateReading {
  /** Decides the intent outright when set. */
  decided?: StatusIntent | 'other';
  /** Extra evidence for an intent (scored with everything else). */
  evidence?: { intent: StatusIntent; weight: number };
  reason?: string;
  companyHint?: string;
  titleHint?: string;
  atsJobId?: string;
}

const SENDER_DOMAINS: [AtsId, RegExp][] = [
  ['greenhouse', /(^|\.)greenhouse(-mail)?\.io$/],
  ['lever', /(^|\.)lever\.co$/],
  ['workday', /(^|\.)(myworkday|workday|myworkdayjobs)\.com$/],
  ['smartrecruiters', /(^|\.)smartrecruiters(mail)?\.com$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
  ['icims', /(^|\.)icims\.com$/],
  ['seek', /(^|\.)seek\.(com\.au|co\.nz|com)$/],
  ['linkedin', /(^|\.)linkedin\.com$/],
];

const POSTING_HOSTS: [AtsId, RegExp][] = [
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['lever', /(^|\.)lever\.co$/],
  ['workday', /\.myworkdayjobs\.com$/],
  ['smartrecruiters', /(^|\.)smartrecruiters\.com$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
  ['icims', /\.icims\.com$/],
  ['seek', /(^|\.)seek\.(com\.au|co\.nz|com)$/],
  ['linkedin', /(^|\.)linkedin\.com$/],
];

/** The recruiting system, from the sender's domain or else the posting links. */
export function detectAts(senderDomain: string, postingUrls: readonly string[]): AtsId | undefined {
  const bySender = SENDER_DOMAINS.find(([, re]) => re.test(senderDomain))?.[0];
  if (bySender) return bySender;
  for (const href of postingUrls) {
    const host = tryParseUrl(href)?.hostname.toLowerCase();
    const byLink = host ? POSTING_HOSTS.find(([, re]) => re.test(host))?.[0] : undefined;
    if (byLink) return byLink;
  }
  return undefined;
}

/** True for addresses of recruiting systems and big mail platforms, which say nothing about the company. */
export function isPlatformDomain(domain: string): boolean {
  return (
    SENDER_DOMAINS.some(([, re]) => re.test(domain)) ||
    /(^|\.)(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|sendgrid|mailgun|mandrillapp|amazonses|indeed|indeedemail|jobadder|pageuppeople|bamboohr|workable|jobvite|teamtailor|recruitee|breezy|jazzhr|successfactors|taleo|oraclecloud)\.(com|net|io|me|co|hr)$/.test(
      domain,
    )
  );
}

// ── Hints: company, title, job id ──────────────────────────────────────────

function tidy(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“(\-–—:|]+|[\s"'”)!.,:;|\-–—]+$/g, '')
    .replace(/^the\s+/i, '')
    .trim();
  return v.length >= 2 && v.length <= 120 ? v : undefined;
}

const ROLE_WORD = '(?:\\s+(?:position|role|job|opening|vacancy|opportunity))?';

const SUBJECT_PATTERNS: RegExp[] = [
  // "Thank you for applying for Data Analyst at Northwind Labs"
  new RegExp(
    `thanks?(?: you)? for (?:applying|your application|your interest)(?: (?:to|for|in))?(?: the)? (?<title>.+?)${ROLE_WORD} (?:at|with) (?<company>.+)$`,
    'i',
  ),
  // "Your application for Data Analyst at Northwind Labs"
  new RegExp(
    `your application (?:for|to)(?: the)? (?<title>.+?)${ROLE_WORD} (?:at|with) (?<company>.+)$`,
    'i',
  ),
  // "Interview invitation: Data Analyst at Northwind Labs" / "– Data Analyst"
  new RegExp(
    `(?:interview|application|assessment|offer)(?: \\w+)? *[-:–—|] *(?<title>.+?)${ROLE_WORD}(?: (?:at|with|-|–|\\|) (?<company>.+))?$`,
    'i',
  ),
  // "Thank you for applying to Northwind Labs"
  /thanks?(?: you)? for (?:applying|your application|your interest)(?: (?:to|in|at|with)) (?<company>.+)$/i,
  // "Your application to Northwind Labs"
  /your application (?:to|at|with) (?<company>.+)$/i,
  // LinkedIn: "Sam, your application was sent to Northwind Labs"
  /your application was (?:sent|viewed) (?:to|by) (?<company>.+)$/i,
  // "Update on your application with Northwind Labs"
  /update (?:on|regarding|about) your application (?:with|at|to|for) (?<company>.+)$/i,
];

const BODY_TITLE_PATTERNS: RegExp[] = [
  new RegExp(
    `(?:for|to|in) the (?<title>[A-Z][\\w/&+,.' -]{2,80}?)${ROLE_WORD}(?= (?:at|with) |[.,]| has| is)`,
  ),
  /\bposition of (?<title>[A-Z][\w/&+.' -]{2,80}?)(?= (?:at|with) |[.,])/,
  /\b(?:applied|application) for (?:the )?(?<title>[A-Z][\w/&+.' -]{2,80}?)(?: (?:position|role))?(?= (?:at|with) |[.,])/,
];

const NAME_NOISE =
  /\b(careers?|recruit(?:ing|ment|er)?|talent(?: acquisition)?|hiring(?: team)?|jobs?|people(?: team)?|hr|human resources|team|no-?reply|notifications?|via \w+|on behalf of)\b/gi;

/** "Northwind Labs Careers" → "Northwind Labs"; platform names give nothing. */
export function companyFromSenderName(
  name: string | undefined,
  ats: AtsId | undefined,
): string | undefined {
  if (!name) return undefined;
  const cleaned = tidy(name.replace(NAME_NOISE, ' ').replace(/[@<>]/g, ' '));
  if (!cleaned) return undefined;
  if (ats && cleaned.toLowerCase().replace(/\s/g, '') === ats) return undefined;
  if (
    /^(linkedin|seek|indeed|workday|greenhouse|lever|smartrecruiters|ashby|icims)$/i.test(cleaned)
  )
    return undefined;
  return cleaned;
}

const JOB_ID_TEXT =
  /\b(?:job|req(?:uisition)?|reference|ref|vacancy|position)\.? ?(?:id|no\.?|number|#|code)\s*[:#]?\s*(?<id>[A-Z0-9][A-Z0-9_-]{2,24})\b/i;

/** A recruiting-system job id from a posting link (Workday `_R12345`, Greenhouse `/jobs/123`, …). */
export function jobIdFromUrl(href: string): string | undefined {
  const url = tryParseUrl(href);
  if (!url) return undefined;
  const host = url.hostname.toLowerCase();
  const on = (...domains: string[]): boolean =>
    domains.some((d) => host === d || host.endsWith(`.${d}`));
  const path = url.pathname;
  if (on('greenhouse.io'))
    return (
      /\/jobs\/(\d+)/.exec(path)?.[1] ??
      url.searchParams.get('gh_jid') ??
      url.searchParams.get('token') ??
      undefined
    );
  if (on('lever.co', 'ashbyhq.com'))
    return /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(path)?.[1];
  if (on('myworkdayjobs.com'))
    return /_([A-Za-z]*[-_]?\d[\w-]*)$/.exec(path.replace(/\/apply(\/.*)?$/, ''))?.[1];
  if (on('smartrecruiters.com')) return /\/(\d{6,})(?:-|$)/.exec(path)?.[1];
  if (on('icims.com')) return /\/jobs\/(\d+)/.exec(path)?.[1];
  if (on('seek.com.au', 'seek.co.nz', 'seek.com')) return /\/job\/(\d+)/.exec(path)?.[1];
  if (on('linkedin.com')) return /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/.exec(path)?.[1];
  return undefined;
}

export function extractHints(
  ctx: TemplateContext,
): Pick<TemplateReading, 'companyHint' | 'titleHint' | 'atsJobId'> {
  let companyHint: string | undefined;
  let titleHint: string | undefined;
  const subject = ctx.subject.replace(/^(?:(?:re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  for (const re of SUBJECT_PATTERNS) {
    const m = re.exec(subject);
    if (!m?.groups) continue;
    companyHint ??= tidy(m.groups.company);
    titleHint ??= tidy(m.groups.title);
    if (companyHint && titleHint) break;
  }
  if (!titleHint) {
    for (const re of BODY_TITLE_PATTERNS) {
      const t = tidy(re.exec(ctx.body)?.groups?.title);
      if (t) {
        titleHint = t;
        break;
      }
    }
  }
  companyHint ??= companyFromSenderName(ctx.senderName, ctx.ats);
  let atsJobId: string | undefined;
  for (const href of ctx.postingUrls) {
    atsJobId = jobIdFromUrl(href);
    if (atsJobId) break;
  }
  atsJobId ??= JOB_ID_TEXT.exec(`${subject}\n${ctx.body}`)?.groups?.id;
  return { companyHint, titleHint, atsJobId };
}

// ── Template readers ───────────────────────────────────────────────────────

const JOB_ALERT =
  /\b(?:jobs? (?:you (?:may|might) (?:be interested in|like)|for you|alert)|new jobs?(?: (?:match|for|similar))|recommended jobs?|is hiring|are hiring|jobs? matching|top job picks)\b/i;

const RECEIPT_SUBJECT =
  /\b(?:thanks?(?: you)? for (?:applying|your application|your interest)|application (?:received|confirmation|submitted|acknowledg(?:e)?ment)|we(?:'ve| have) received your application|your application (?:has been|was) (?:received|submitted))\b/i;

export function readTemplate(ctx: TemplateContext): TemplateReading {
  const hints = extractHints(ctx);
  const subject = ctx.subject;
  switch (ctx.ats) {
    case 'linkedin':
      if (/your application was sent to/i.test(subject))
        return { ...hints, decided: 'received', reason: 'LinkedIn: application sent' };
      if (/your application was viewed/i.test(subject))
        return { ...hints, decided: 'other', reason: 'LinkedIn: application viewed' };
      if (JOB_ALERT.test(subject))
        return { ...hints, decided: 'other', reason: 'LinkedIn: job alert' };
      break;
    case 'seek':
      if (
        /(?:application|applied).*\b(?:sent|submitted)\b|\bapplication (?:sent|submitted)/i.test(
          subject,
        )
      )
        return { ...hints, decided: 'received', reason: 'SEEK: application submitted' };
      if (/application (?:was )?viewed|viewed your application/i.test(subject))
        return { ...hints, decided: 'other', reason: 'SEEK: application viewed' };
      if (JOB_ALERT.test(subject) || /new jobs?\b/i.test(subject))
        return { ...hints, decided: 'other', reason: 'SEEK: job alert' };
      break;
    default:
      break;
  }
  if (ctx.ats && RECEIPT_SUBJECT.test(subject)) {
    return {
      ...hints,
      evidence: { intent: 'received', weight: 2 },
      reason: `${ctx.ats}: receipt template`,
    };
  }
  return hints;
}
