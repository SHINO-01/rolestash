import {
  boardView,
  finishedAt,
  FREE_HISTORY_DAYS,
  historyStart,
  historyView,
  visibleActivity,
} from '@/domain/history';
import type { Activity, Job } from '@/domain/job';
import { DEFAULT_STAGES } from '@/domain/stage';
import { makeJob } from '../helpers/factories';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const moved = (to: string, days: number): Activity => ({
  id: `m-${to}-${String(days)}`,
  at: daysAgo(days),
  type: 'stage_changed',
  fromStageId: 'applied',
  toStageId: to,
});
const finished = (id: string, stageId: string, days: number, extra: Partial<Job> = {}) =>
  makeJob({
    id,
    stageId,
    createdAt: daysAgo(days + 10),
    activity: [moved(stageId, days)],
    ...extra,
  });

const jobs = [
  makeJob({ id: 'open', stageId: 'applied', createdAt: daysAgo(90) }),
  finished('offer-new', 'offer', 3),
  finished('rejected-old', 'rejected', 45),
  finished('withdrawn-new', 'withdrawn', 29),
  makeJob({ id: 'arch-new', archivedAt: daysAgo(2) }),
  makeJob({ id: 'arch-old', archivedAt: daysAgo(60) }),
];
const free = historyStart('free', NOW);

describe('history window', () => {
  it('is 30 days on Free and unlimited on paid plans or without accounts', () => {
    expect(free?.toISOString()).toBe(daysAgo(FREE_HISTORY_DAYS));
    expect(historyStart('pro', NOW)).toBeUndefined();
    expect(historyStart('advanced', NOW)).toBeUndefined();
    expect(historyStart(undefined, NOW)).toBeUndefined();
  });

  it('dates a finished job by its last move into the stage', () => {
    const job = makeJob({
      stageId: 'offer',
      createdAt: daysAgo(50),
      activity: [moved('offer', 20), moved('applied', 10), moved('offer', 5)],
    });
    expect(finishedAt(job)).toBe(daysAgo(5));
    expect(finishedAt(makeJob({ stageId: 'offer', createdAt: daysAgo(7) }))).toBe(daysAgo(7));
  });
});

describe('boardView', () => {
  it('hides archived jobs, and finished jobs beyond the window on Free', () => {
    const view = boardView(jobs, DEFAULT_STAGES, free);
    expect(view.board.map((j) => j.id)).toEqual(['open', 'offer-new', 'withdrawn-new']);
    expect(view.hidden).toBe(1);
  });

  it('keeps every finished job on paid plans', () => {
    const view = boardView(jobs, DEFAULT_STAGES, undefined);
    expect(view.board.map((j) => j.id)).toEqual([
      'open',
      'offer-new',
      'rejected-old',
      'withdrawn-new',
    ]);
    expect(view.hidden).toBe(0);
  });
});

describe('historyView', () => {
  it('lists finished jobs newest first, windowed on Free', () => {
    expect(historyView(jobs, DEFAULT_STAGES, 'finished', free)).toEqual({
      jobs: [jobs[1], jobs[3]],
      hidden: 1,
    });
    expect(historyView(jobs, DEFAULT_STAGES, 'finished').jobs.map((j) => j.id)).toEqual([
      'offer-new',
      'withdrawn-new',
      'rejected-old',
    ]);
  });

  it('lists archived jobs, windowed on Free', () => {
    const view = historyView(jobs, DEFAULT_STAGES, 'archived', free);
    expect(view.jobs.map((j) => j.id)).toEqual(['arch-new']);
    expect(view.hidden).toBe(1);
    expect(historyView(jobs, DEFAULT_STAGES, 'archived').jobs).toHaveLength(2);
  });
});

describe('visibleActivity', () => {
  const activity: Activity[] = [
    { id: '1', at: daysAgo(40), type: 'created', toStageId: 'saved' },
    moved('applied', 31),
    moved('offer', 2),
  ];

  it('shows recent entries newest first and counts the rest on Free', () => {
    const view = visibleActivity(activity, free);
    expect(view.items.map((a) => a.id)).toEqual(['m-offer-2']);
    expect(view.hidden).toBe(2);
  });

  it('shows everything on paid plans', () => {
    expect(visibleActivity(activity).items.map((a) => a.id)).toEqual([
      'm-offer-2',
      'm-applied-31',
      '1',
    ]);
  });
});
