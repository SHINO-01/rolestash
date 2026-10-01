import { isManualUrl, type Job } from '../domain/job';
import type { Stage, StageId } from '../domain/stage';
import { findAdapterByHost } from '../extraction/adapters/registry';
import { canonicalizeUrl, tryParseUrl } from '../extraction/normalize/url';
import { isPlatformDomain } from './ats';
import type { EmailEvent, StatusIntent } from './types';

/**
 * Matching an email event to a job (ADR-0014 §5). Pure; it runs in the
 * extension, where the jobs are. A match needs a minimum score *and* a clear
 * margin over the runner-up; anything else goes to "Unsorted".
 */

export interface MatchMemory {
  /** Message-ID → job id, for emails already matched (thread following). */
  threads?: Readonly<Record<string, string>>;
  /** Sender address → job id, taught when the user assigns an unsorted update. */
  senders?: Readonly<Record<string, string>>;
}

export interface MatchCandidate {
  jobId: string;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  jobId?: string;
  outcome: 'thread' | 'matched' | 'ambiguous' | 'none';
  candidates: MatchCandidate[];
}

export const MATCH_MIN_SCORE = 4;
export const MATCH_MARGIN = 3;
const RECENT_DAYS = 365;

/** The posting URL in the same canonical form capture stores in `job.source.url`. */
export function canonicalPostingUrl(href: string): string {
  const url = tryParseUrl(href);
  if (!url) return href;
  try {
    const custom = findAdapterByHost(url)?.canonicalUrl?.(url);
    if (custom) return custom;
  } catch {
    // fall through to the generic form
  }
  return canonicalizeUrl(href);
}

function postingId(href: string): string | undefined {
  const url = tryParseUrl(href);
  if (!url) return undefined;
  try {
    return findAdapterByHost(url)?.externalId?.(url);
  } catch {
    return undefined;
  }
}

const LEGAL_SUFFIX =
  /\b(pty|ltd|limited|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|ag|sa|bv|nv|group|holdings|australia|aus|au|the)\b\.?/g;

/** "Northwind Labs Pty Ltd" → "northwind labs". */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_ABBREVIATIONS: Record<string, string> = {
  sr: 'senior',
  snr: 'senior',
  jr: 'junior',
  jnr: 'junior',
  mgr: 'manager',
  eng: 'engineer',
  engr: 'engineer',
  dev: 'developer',
  swe: 'software engineer',
  sde: 'software engineer',
  pm: 'product manager',
  ba: 'business analyst',
  qa: 'quality assurance',
  ux: 'user experience',
  ui: 'user interface',
  hr: 'human resources',
  admin: 'administrator',
  assoc: 'associate',
  asst: 'assistant',
  dir: 'director',
  ops: 'operations',
  fe: 'frontend',
  be: 'backend',
};
const TITLE_STOP = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'of',
  'for',
  'to',
  'in',
  'at',
  'with',
  'm',
  'f',
  'd',
  'x',
]);

export function titleTokens(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/front[- ]end/g, 'frontend')
    .replace(/back[- ]end/g, 'backend')
    .replace(/full[- ]stack/g, 'fullstack')
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean)
    .flatMap((w) => (TITLE_ABBREVIATIONS[w] ?? w).split(' '));
  return new Set(words.filter((w) => !TITLE_STOP.has(w)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size);
}

/** The registrable part of a host, without a public-suffix list: good enough for company domains. */
export function siteDomain(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  const n = labels.length;
  if (
    n >= 3 &&
    (labels[n - 1] ?? '').length === 2 &&
    /^(com|co|org|net|gov|edu|ac|id)$/.test(labels[n - 2] ?? '')
  ) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

/** The company's own domains we know from the job: posting and apply links off job boards. */
function companyDomains(job: Job): string[] {
  const out = new Set<string>();
  for (const href of [job.source.url, job.applyUrl]) {
    const url = href && !isManualUrl(href) ? tryParseUrl(href) : undefined;
    // A job board or ATS host says nothing about the company.
    if (url && !findAdapterByHost(url)) out.add(siteDomain(url.hostname));
  }
  return [...out];
}

function eligible(job: Job, intent: StatusIntent, stages: readonly Stage[], at: number): boolean {
  if (job.archivedAt) return false;
  const stage = stages.find((s) => s.id === job.stageId);
  if (stage?.kind !== 'active') return false;
  const since = Date.parse(job.appliedAt ?? job.createdAt);
  if (Number.isFinite(since) && at - since > RECENT_DAYS * 86_400_000) return false;
  // Only "received" may match a job still in a not-yet-applied column.
  return intent === 'received' || stage.marksApplied || Boolean(job.appliedAt);
}

function scoreJob(
  job: Job,
  event: EmailEvent,
  memory: MatchMemory,
  postings: Set<string>,
  postingIds: Set<string>,
): MatchCandidate {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, why: string): void => {
    score += points;
    reasons.push(why);
  };

  if (memory.senders?.[event.sender.address] === job.id) add(8, 'sender taught');

  const jobUrls = [job.source.url, job.applyUrl]
    .filter((u): u is string => Boolean(u))
    .map(canonicalPostingUrl);
  if (jobUrls.some((u) => postings.has(u))) add(10, 'posting link');

  const ids = [job.externalId, postingId(job.source.url)]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
  if (ids.length && (postingIds.size || event.atsJobId)) {
    const emailIds = new Set([
      ...postingIds,
      ...(event.atsJobId ? [event.atsJobId.toLowerCase()] : []),
    ]);
    if (ids.some((id) => emailIds.has(id)))
      add(event.ats && job.source.siteId === event.ats ? 8 : 5, 'job id');
  }

  const company = normalizeCompany(job.company);
  if (company.length >= 2) {
    const squashed = company.replace(/ /g, '');
    const hint = event.companyHint ? normalizeCompany(event.companyHint) : '';
    const domain = event.sender.domain;
    if (
      hint &&
      (hint === company || overlap(new Set(hint.split(' ')), new Set(company.split(' '))) >= 0.8)
    )
      add(4, 'company name');
    else if (
      ` ${normalizeCompany(`${event.subject} ${event.sender.name ?? ''}`)} `.includes(
        ` ${company} `,
      )
    )
      add(3, 'company in subject');
    if (domain && !isPlatformDomain(domain)) {
      const site = siteDomain(domain);
      if (companyDomains(job).includes(site)) add(4, 'company domain');
      else if (squashed.length >= 4 && site.split('.')[0]?.includes(squashed))
        add(4, 'sender domain');
    }
  }

  const jobTitle = titleTokens(job.title);
  const hintTitle = event.titleHint ? titleTokens(event.titleHint) : undefined;
  const titleScore = hintTitle ? overlap(jobTitle, hintTitle) : 0;
  const subjectTokens = titleTokens(event.subject);
  const inSubject = jobTitle.size > 0 && [...jobTitle].every((w) => subjectTokens.has(w));
  if (titleScore >= 0.8 || inSubject) add(3, 'title');
  else if (titleScore >= 0.5) add(1.5, 'similar title');

  return { jobId: job.id, score, reasons };
}

export function matchEvent(
  event: EmailEvent,
  intent: StatusIntent,
  jobs: readonly Job[],
  stages: readonly Stage[],
  memory: MatchMemory = {},
): MatchResult {
  // Thread following: a reply in a thread we've matched before.
  for (const id of [event.thread.inReplyTo, ...event.thread.references].filter(Boolean)) {
    const jobId = memory.threads?.[id ?? ''];
    const job = jobId ? jobs.find((j) => j.id === jobId && !j.archivedAt) : undefined;
    if (job)
      return {
        jobId: job.id,
        outcome: 'thread',
        candidates: [{ jobId: job.id, score: 100, reasons: ['thread'] }],
      };
  }

  const at = Date.parse(event.receivedAt);
  const postings = new Set(event.postingUrls.map(canonicalPostingUrl));
  const postingIds = new Set(
    event.postingUrls
      .map(postingId)
      .filter((v): v is string => Boolean(v))
      .map((v) => v.toLowerCase()),
  );
  const candidates = jobs
    .filter((j) => eligible(j, intent, stages, at))
    .map((j) => scoreJob(j, event, memory, postings, postingIds))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1]?.score ?? 0;
  if (!best || best.score < MATCH_MIN_SCORE)
    return { outcome: 'none', candidates: candidates.slice(0, 3) };
  if (best.score - second < MATCH_MARGIN)
    return { outcome: 'ambiguous', candidates: candidates.slice(0, 3) };
  return { jobId: best.jobId, outcome: 'matched', candidates: candidates.slice(0, 3) };
}

// ── Where an update moves a card ───────────────────────────────────────────

function stageFor(
  stages: readonly Stage[],
  id: StageId,
  fallback: (s: Stage) => boolean,
): Stage | undefined {
  const live = stages.filter((s) => !s.archived);
  return live.find((s) => s.id === id) ?? live.find(fallback);
}

/**
 * The column an update moves a job to, or undefined when it shouldn't move.
 * Updates never move a card backwards: an "application received" for a job
 * already in Interviewing changes nothing.
 */
export function targetStage(
  intent: StatusIntent,
  job: Job,
  stages: readonly Stage[],
): StageId | undefined {
  const live = stages.filter((s) => !s.archived);
  const current = live.findIndex((s) => s.id === job.stageId);
  const currentStage = live[current];
  if (!currentStage) return undefined;
  const forward = (target: Stage | undefined): StageId | undefined => {
    if (!target || target.id === currentStage.id) return undefined;
    if (currentStage.kind !== 'active') return undefined;
    return live.indexOf(target) > current ? target.id : undefined;
  };
  switch (intent) {
    case 'received':
      return currentStage.marksApplied
        ? undefined
        : forward(stageFor(stages, 'applied', (s) => s.kind === 'active' && s.marksApplied));
    case 'assessment':
      return forward(
        stageFor(
          stages,
          'screening',
          (s) => s.kind === 'active' && /screen|assess|test/i.test(s.name),
        ),
      );
    case 'interview':
      return forward(
        stageFor(stages, 'interviewing', (s) => s.kind === 'active' && /interview/i.test(s.name)),
      );
    case 'offer': {
      const target = stageFor(stages, 'offer', (s) => s.kind === 'won');
      return target && currentStage.kind === 'active' ? target.id : undefined;
    }
    case 'rejected': {
      const target = stageFor(
        stages,
        'rejected',
        (s) => s.kind === 'lost' && !/withdr/i.test(s.name),
      );
      return target && currentStage.kind === 'active' ? target.id : undefined;
    }
  }
}
