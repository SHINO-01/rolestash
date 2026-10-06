import { isManualUrl, type Job } from './job';
import { retiredStageAlias, type Stage } from './stage';

/**
 * Insights (Pro): how your search is going, worked out on this device
 * from your own board. Nothing is tracked or sent. Pure functions of the jobs,
 * the columns and "now", so they're easy to test.
 *
 * "Applied" means a job has `appliedAt`, archived ones included: an archived
 * application still happened.
 */

const DAY_MS = 86_400_000;
/** After this long without a reply, an application counts as unanswered. */
export const NO_REPLY_DAYS = 21;

const applied = (jobs: readonly Job[]) => jobs.filter((j) => j.appliedAt !== undefined);

/** Moves that count, in time order: manual moves and email updates that weren't undone. */
function moves(job: Job) {
  return job.activity.filter(
    (a) => a.type === 'stage_changed' || (a.type === 'email_update' && !a.undone && a.toStageId),
  );
}

/**
 * Every column a job has been in. Retired columns count as the ones that
 * replaced them (Screening as Interviewing; ADR-0034).
 */
export function stagesReached(job: Job): Set<string> {
  const reached = new Set<string>([job.stageId]);
  for (const a of job.activity) {
    if (a.type === 'email_update' && a.undone) continue;
    if (a.toStageId) reached.add(retiredStageAlias(a.toStageId) ?? a.toStageId);
  }
  return reached;
}

// ── Applications per week ──────────────────────────────────────────────────

/** Monday of the week containing `date`, as a local YYYY-MM-DD. */
export function weekStart(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface WeekCount {
  /** Local Monday, YYYY-MM-DD. */
  week: string;
  count: number;
}

/** Applications per week for the last `weeks` weeks, oldest first, this week last. */
export function applicationsPerWeek(jobs: readonly Job[], now: Date, weeks = 12): WeekCount[] {
  const out: WeekCount[] = [];
  const index = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) {
    const week = weekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7));
    index.set(week, out.length);
    out.push({ week, count: 0 });
  }
  for (const job of applied(jobs)) {
    const i = index.get(weekStart(new Date(job.appliedAt ?? '')));
    const row = i === undefined ? undefined : out[i];
    if (row) row.count++;
  }
  return out;
}

// ── How far applications get ───────────────────────────────────────────────

export interface FunnelStep {
  stageId: string;
  name: string;
  /** Applications that reached this column or a later one. */
  count: number;
  /** count / applications, 0..1. */
  rate: number;
}

/**
 * The applied columns in board order (Applied, Interviewing…)
 * then the "won" ones (Offer). Moves can skip columns, so a job counts for
 * every step up to the furthest one it reached.
 */
export function funnel(jobs: readonly Job[], stages: readonly Stage[]): FunnelStep[] {
  const steps = [
    ...stages.filter((s) => !s.archived && s.kind === 'active' && s.marksApplied),
    ...stages.filter((s) => !s.archived && s.kind === 'won'),
  ];
  const position = new Map(steps.map((s, i) => [s.id, i]));
  const counts = steps.map(() => 0);
  const list = applied(jobs);
  for (const job of list) {
    let furthest = 0; // every application reached the first step
    for (const id of stagesReached(job)) furthest = Math.max(furthest, position.get(id) ?? 0);
    for (let i = 0; i <= furthest; i++) counts[i] = (counts[i] ?? 0) + 1;
  }
  return steps.map((s, i) => ({
    stageId: s.id,
    name: s.name,
    count: counts[i] ?? 0,
    rate: list.length ? (counts[i] ?? 0) / list.length : 0,
  }));
}

// ── Replies ────────────────────────────────────────────────────────────────

/** Days from applying to the first move after it (any reply: screen, interview, rejection…). */
export function daysToReply(job: Job): number | undefined {
  if (!job.appliedAt) return undefined;
  const from = Date.parse(job.appliedAt);
  const first = moves(job).find(
    (a) => Date.parse(a.at) > from && a.fromStageId !== undefined && a.toStageId !== a.fromStageId,
  );
  return first ? Math.max(0, (Date.parse(first.at) - from) / DAY_MS) : undefined;
}

export interface Replies {
  applications: number;
  replied: number;
  /** replied / applications, 0..1 (0 with no applications). */
  rate: number;
  /** Median days to a reply, among applications that got one. */
  medianDays?: number;
  /** Still waiting after NO_REPLY_DAYS. */
  unanswered: number;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function replies(jobs: readonly Job[], now: Date): Replies {
  const list = applied(jobs);
  const days = list.map(daysToReply);
  const answered = days.filter((d): d is number => d !== undefined);
  const unanswered = list.filter(
    (j, i) =>
      days[i] === undefined &&
      !j.archivedAt &&
      now.getTime() - Date.parse(j.appliedAt ?? '') > NO_REPLY_DAYS * DAY_MS,
  ).length;
  const medianDays = median(answered);
  return {
    applications: list.length,
    replied: answered.length,
    rate: list.length ? answered.length / list.length : 0,
    ...(medianDays !== undefined ? { medianDays } : {}),
    unanswered,
  };
}

// ── Where applications come from ───────────────────────────────────────────

export interface SourceRow {
  source: string;
  applications: number;
  replied: number;
  interviews: number;
  offers: number;
}

/** Interview columns: the default "interviewing", or any column named like it. */
function isInterviewStage(stage: Stage): boolean {
  return stage.id === 'interviewing' || /interview/i.test(stage.name);
}

/** Applications grouped by where they were found, busiest first; the rest fold into "Other". */
export function bySource(jobs: readonly Job[], stages: readonly Stage[], limit = 8): SourceRow[] {
  const interviewIds = new Set(stages.filter(isInterviewStage).map((s) => s.id));
  const wonIds = new Set(stages.filter((s) => s.kind === 'won').map((s) => s.id));
  const rows = new Map<string, SourceRow>();
  for (const job of applied(jobs)) {
    const source = isManualUrl(job.source.url) ? 'Added by hand' : job.source.siteName;
    const row = rows.get(source) ?? {
      source,
      applications: 0,
      replied: 0,
      interviews: 0,
      offers: 0,
    };
    const reached = stagesReached(job);
    row.applications++;
    if (daysToReply(job) !== undefined) row.replied++;
    if ([...reached].some((id) => interviewIds.has(id))) row.interviews++;
    if ([...reached].some((id) => wonIds.has(id))) row.offers++;
    rows.set(source, row);
  }
  const sorted = [...rows.values()].sort(
    (a, b) => b.applications - a.applications || a.source.localeCompare(b.source),
  );
  if (sorted.length <= limit) return sorted;
  const other = sorted.slice(limit - 1).reduce<SourceRow>(
    (sum, r) => ({
      source: 'Other',
      applications: sum.applications + r.applications,
      replied: sum.replied + r.replied,
      interviews: sum.interviews + r.interviews,
      offers: sum.offers + r.offers,
    }),
    { source: 'Other', applications: 0, replied: 0, interviews: 0, offers: 0 },
  );
  return [...sorted.slice(0, limit - 1), other];
}

/** Applications in the last `days` days. */
export function appliedWithin(jobs: readonly Job[], now: Date, days: number): number {
  return applied(jobs).filter((j) => now.getTime() - Date.parse(j.appliedAt ?? '') <= days * DAY_MS)
    .length;
}

// ── Where applications end up (the journey chart) ──────────────────────────

export type JourneyNodeKind = 'start' | 'stage' | 'won' | 'ended' | 'waiting';

export interface JourneyNode {
  id: string;
  label: string;
  kind: JourneyNodeKind;
  /** Applications through this node: the larger of what flows in and out. */
  value: number;
  /**
   * Left to right: 0 is Applications, then columns in the order reached;
   * every outcome (Rejected, No reply, Waiting…) shares the last column, so
   * flows never pass behind another node.
   */
  column: number;
}

export interface JourneyLink {
  source: string;
  target: string;
  value: number;
}

export interface Journey {
  applications: number;
  nodes: JourneyNode[];
  links: JourneyLink[];
}

export const JOURNEY_START = 'applications';
const NO_REPLY = 'outcome:no-reply';
const WAITING = 'outcome:waiting';

/**
 * Every application as a path: Applications, then each later column it
 * reached in board order (so custom columns such as "Online assessment" or
 * "Accepted" appear), then how it ended: the lost column it's in (Rejected),
 * no reply after NO_REPLY_DAYS, or still waiting. Jobs still moving through
 * the board stop at the furthest column they reached.
 */
export function journey(jobs: readonly Job[], stages: readonly Stage[], now: Date): Journey {
  const live = stages.filter((s) => !s.archived);
  const progress = [
    ...live.filter((s) => s.kind === 'active' && s.marksApplied),
    ...live.filter((s) => s.kind === 'won'),
  ];
  // The first applied column ("Applied") is the start node itself.
  const after = progress.slice(1);
  const byId = new Map(stages.map((s) => [s.id, s]));
  const links = new Map<string, JourneyLink>();
  const meta = new Map<string, { label: string; kind: JourneyNodeKind; order: number }>([
    [JOURNEY_START, { label: 'Applications', kind: 'start', order: -1 }],
  ]);
  after.forEach((s, i) =>
    meta.set(s.id, { label: s.name, kind: s.kind === 'won' ? 'won' : 'stage', order: i }),
  );
  const link = (source: string, target: string) => {
    const key = `${source}>${target}`;
    const row = links.get(key) ?? { source, target, value: 0 };
    row.value++;
    links.set(key, row);
  };

  const list = applied(jobs);
  for (const job of list) {
    const reached = stagesReached(job);
    const path = [JOURNEY_START, ...after.filter((s) => reached.has(s.id)).map((s) => s.id)];
    const current = byId.get(job.stageId);
    let end: string | undefined;
    if (current?.kind === 'lost') {
      end = `outcome:${current.id}`;
      meta.set(end, { label: current.name, kind: 'ended', order: 1000 + live.indexOf(current) });
    } else if (path.length === 1) {
      const waited = now.getTime() - Date.parse(job.appliedAt ?? '') > NO_REPLY_DAYS * DAY_MS;
      end = waited || job.archivedAt ? NO_REPLY : WAITING;
      meta.set(
        end,
        end === NO_REPLY
          ? { label: 'No reply', kind: 'ended', order: 2000 }
          : { label: 'Waiting to hear', kind: 'waiting', order: 3000 },
      );
    }
    if (end) path.push(end);
    for (let i = 1; i < path.length; i++) link(path[i - 1] ?? '', path[i] ?? '');
  }

  const linkList = [...links.values()];
  // Columns: longest path from the start. Links only go forward in board
  // order, then to an outcome, so there are no cycles.
  const column = new Map<string, number>([[JOURNEY_START, 0]]);
  const ordered = [...meta.entries()].sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  for (const id of ordered) {
    for (const l of linkList)
      if (l.source === id && column.has(id))
        column.set(l.target, Math.max(column.get(l.target) ?? 0, (column.get(id) ?? 0) + 1));
  }
  const isOutcome = (id: string) => id.startsWith('outcome:');
  const lastStage = Math.max(
    0,
    ...[...column.entries()].filter(([id]) => !isOutcome(id)).map(([, c]) => c),
  );
  for (const id of column.keys()) if (isOutcome(id)) column.set(id, lastStage + 1);
  const nodes: JourneyNode[] = ordered
    .filter((id) => id === JOURNEY_START || linkList.some((l) => l.target === id))
    .map((id) => {
      const m = meta.get(id) ?? { label: id, kind: 'stage' as const, order: 0 };
      const sum = (pick: (l: JourneyLink) => boolean) =>
        linkList.filter(pick).reduce((n, l) => n + l.value, 0);
      return {
        id,
        label: m.label,
        kind: m.kind,
        value:
          id === JOURNEY_START
            ? list.length
            : Math.max(
                sum((l) => l.target === id),
                sum((l) => l.source === id),
              ),
        column: column.get(id) ?? 0,
      };
    });
  return { applications: list.length, nodes, links: linkList };
}
