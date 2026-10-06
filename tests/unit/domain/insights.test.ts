import {
  applicationsPerWeek,
  appliedWithin,
  bySource,
  daysToReply,
  funnel,
  journey,
  replies,
  stagesReached,
  weekStart,
} from '@/domain/insights';
import type { Activity, Job } from '@/domain/job';
import { DEFAULT_STAGES, type Stage } from '@/domain/stage';
import { makeJob } from '../helpers/factories';

const now = new Date('2026-10-02T12:00:00');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const move = (from: string, to: string, at: string): Activity => ({
  id: `${from}-${to}-${at}`,
  at,
  type: 'stage_changed',
  fromStageId: from,
  toStageId: to,
});
const site = (name: string, url = `https://${name.toLowerCase()}.example/jobs/1`) => ({
  url,
  originalUrl: url,
  siteId: name.toLowerCase(),
  siteName: name,
  capturedAt: daysAgo(60),
});

// a: applied 10 days ago, screened after 3, interviewed, rejected.
// b: applied 30 days ago, never heard back.
// c: applied 2 days ago via an email update to Interviewing, then an offer.
// d: saved only. e: added by hand, applied 40 days ago, archived, no reply.
const jobs: Job[] = [
  makeJob({
    id: 'a',
    stageId: 'rejected',
    appliedAt: daysAgo(10),
    source: site('SEEK'),
    activity: [
      move('saved', 'applied', daysAgo(10)),
      move('applied', 'screening', daysAgo(7)),
      move('screening', 'interviewing', daysAgo(5)),
      move('interviewing', 'rejected', daysAgo(1)),
    ],
  }),
  makeJob({ id: 'b', stageId: 'applied', appliedAt: daysAgo(30), source: site('LinkedIn') }),
  makeJob({
    id: 'c',
    stageId: 'offer',
    appliedAt: daysAgo(2),
    source: site('LinkedIn'),
    activity: [
      {
        id: 'e1',
        at: daysAgo(1),
        type: 'email_update',
        fromStageId: 'applied',
        toStageId: 'interviewing',
        email: { intent: 'interview', subject: 's', sender: 'x', receivedAt: daysAgo(1) },
      },
      {
        id: 'e2',
        at: daysAgo(0.5),
        type: 'email_update',
        fromStageId: 'interviewing',
        toStageId: 'offer',
        undone: true,
        email: { intent: 'offer', subject: 's', sender: 'x', receivedAt: daysAgo(1) },
      },
    ],
  }),
  makeJob({ id: 'd', stageId: 'saved' }),
  makeJob({
    id: 'e',
    stageId: 'applied',
    appliedAt: daysAgo(40),
    archivedAt: daysAgo(5),
    source: site('Manual', 'https://rolestash.invalid/manual/1'),
  }),
];

describe('insights', () => {
  it('knows every column a job has been in, ignoring undone email moves', () => {
    // The retired Screening column counts as Interviewing (ADR-0034).
    expect([...stagesReached(jobs[0]!)].sort()).toEqual(['applied', 'interviewing', 'rejected']);
    expect(stagesReached(jobs[2]!).has('interviewing')).toBe(true);
  });

  it('counts applications per week, Monday to Sunday, this week last', () => {
    expect(weekStart(new Date('2026-10-04T10:00:00'))).toBe('2026-09-28'); // Sunday → Monday before
    expect(weekStart(new Date('2026-09-28T00:30:00'))).toBe('2026-09-28');
    const weeks = applicationsPerWeek(jobs, now, 8);
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)).toEqual({ week: '2026-09-28', count: 1 }); // c
    expect(weeks.reduce((n, w) => n + w.count, 0)).toBe(4); // a, b, c, e (e: 40 days ago is within 8 weeks)
  });

  it('shows how far applications get, counting skipped columns', () => {
    expect(funnel(jobs, DEFAULT_STAGES).map((s) => [s.stageId, s.count])).toEqual([
      ['applied', 4],
      ['interviewing', 2], // a, and c (skipped to Interviewing, then Offer)
      ['offer', 1],
    ]);
    expect(funnel(jobs, DEFAULT_STAGES)[0]?.rate).toBe(1);
    expect(funnel([], DEFAULT_STAGES)[0]).toMatchObject({ count: 0, rate: 0 });
  });

  it('measures replies: rate, median wait, and applications still unanswered', () => {
    expect(daysToReply(jobs[0]!)).toBeCloseTo(3);
    expect(daysToReply(jobs[2]!)).toBeCloseTo(1);
    expect(daysToReply(jobs[1]!)).toBeUndefined();
    expect(daysToReply(jobs[3]!)).toBeUndefined();
    expect(replies(jobs, now)).toEqual({
      applications: 4,
      replied: 2,
      rate: 0.5,
      medianDays: 2,
      unanswered: 1,
    });
    expect(replies([], now)).toEqual({ applications: 0, replied: 0, rate: 0, unanswered: 0 });
  });

  it('groups by source, busiest first, folding the rest into Other', () => {
    expect(bySource(jobs, DEFAULT_STAGES)).toEqual([
      { source: 'LinkedIn', applications: 2, replied: 1, interviews: 1, offers: 1 },
      { source: 'Added by hand', applications: 1, replied: 0, interviews: 0, offers: 0 },
      { source: 'SEEK', applications: 1, replied: 1, interviews: 1, offers: 0 },
    ]);
    expect(bySource(jobs, DEFAULT_STAGES, 2).map((r) => [r.source, r.applications])).toEqual([
      ['LinkedIn', 2],
      ['Other', 2],
    ]);
  });

  it('works with custom columns', () => {
    const custom: Stage[] = [
      { id: 'todo', name: 'To apply', color: 'slate', kind: 'active', marksApplied: false },
      { id: 'sent', name: 'Sent', color: 'sky', kind: 'active', marksApplied: true },
      { id: 'talks', name: 'Interviews', color: 'amber', kind: 'active', marksApplied: true },
      { id: 'hired', name: 'Hired', color: 'emerald', kind: 'won', marksApplied: true },
      { id: 'old', name: 'Old', color: 'zinc', kind: 'active', marksApplied: true, archived: true },
    ];
    const job = makeJob({
      stageId: 'talks',
      appliedAt: daysAgo(3),
      activity: [move('sent', 'talks', daysAgo(1))],
    });
    expect(funnel([job], custom).map((s) => [s.stageId, s.count])).toEqual([
      ['sent', 1],
      ['talks', 1],
      ['hired', 0],
    ]);
    expect(bySource([job], custom)[0]?.interviews).toBe(1);
  });

  it('counts recent applications', () => {
    expect(appliedWithin(jobs, now, 30)).toBe(3);
  });
});

describe('journey', () => {
  const at = (n: number) => daysAgo(n);
  const flows = (j: ReturnType<typeof journey>) =>
    Object.fromEntries(j.links.map((l) => [`${l.source}>${l.target}`, l.value]));

  it('follows each application to where it ended up', () => {
    const list: Job[] = [
      // Rejected straight after applying.
      makeJob({
        id: '1',
        stageId: 'rejected',
        appliedAt: at(20),
        activity: [move('applied', 'rejected', at(15))],
      }),
      // Screened, interviewed, then an offer.
      makeJob({
        id: '2',
        stageId: 'offer',
        appliedAt: at(30),
        activity: [
          move('applied', 'screening', at(25)),
          move('screening', 'interviewing', at(20)),
          move('interviewing', 'offer', at(5)),
        ],
      }),
      // Interviewed (skipping screening), then rejected.
      makeJob({
        id: '3',
        stageId: 'rejected',
        appliedAt: at(30),
        activity: [
          move('applied', 'interviewing', at(20)),
          move('interviewing', 'rejected', at(10)),
        ],
      }),
      // Nothing for 40 days; and one applied yesterday.
      makeJob({ id: '4', stageId: 'applied', appliedAt: at(40) }),
      makeJob({ id: '5', stageId: 'applied', appliedAt: at(1) }),
      // Saved only: not an application.
      makeJob({ id: '6', stageId: 'saved' }),
    ];
    const j = journey(list, DEFAULT_STAGES, now);
    expect(j.applications).toBe(5);
    expect(flows(j)).toEqual({
      'applications>outcome:rejected': 1,
      'applications>interviewing': 2,
      'interviewing>offer': 1,
      'interviewing>outcome:rejected': 1,
      'applications>outcome:no-reply': 1,
      'applications>outcome:waiting': 1,
    });
    const node = (id: string) => j.nodes.find((n) => n.id === id);
    expect(node('applications')).toMatchObject({ value: 5, column: 0, kind: 'start' });
    // Job 2 went through the retired Screening column, which counts as Interviewing.
    expect(node('screening')).toBeUndefined();
    expect(node('interviewing')).toMatchObject({ value: 2, column: 1 });
    expect(node('offer')).toMatchObject({ value: 1, column: 2, kind: 'won' });
    // One node for every way it ended, all in the last column.
    expect(node('outcome:rejected')).toMatchObject({
      value: 2,
      column: 3,
      kind: 'ended',
      label: 'Rejected',
    });
    expect(node('outcome:no-reply')).toMatchObject({ label: 'No reply', kind: 'ended', column: 3 });
    expect(node('outcome:waiting')).toMatchObject({ label: 'Waiting to hear', kind: 'waiting' });
  });

  it('shows custom columns, such as an assessment step or Accepted', () => {
    const stages: Stage[] = [
      ...DEFAULT_STAGES.slice(0, 2),
      { id: 'oa', name: 'Online assessment', color: 'sky', kind: 'active', marksApplied: true },
      ...DEFAULT_STAGES.slice(2),
      { id: 'accepted', name: 'Accepted', color: 'emerald', kind: 'won', marksApplied: true },
    ];
    const j = journey(
      [
        makeJob({
          id: 'x',
          stageId: 'accepted',
          appliedAt: at(30),
          activity: [
            move('applied', 'oa', at(25)),
            move('oa', 'offer', at(10)),
            move('offer', 'accepted', at(5)),
          ],
        }),
      ],
      stages,
      now,
    );
    expect(flows(j)).toEqual({ 'applications>oa': 1, 'oa>offer': 1, 'offer>accepted': 1 });
    expect(j.nodes.map((n) => n.label)).toEqual([
      'Applications',
      'Online assessment',
      'Offer',
      'Accepted',
    ]);
  });

  it('is empty with no applications', () => {
    expect(journey([makeJob({ id: 's' })], DEFAULT_STAGES, now)).toEqual({
      applications: 0,
      nodes: [{ id: 'applications', label: 'Applications', kind: 'start', value: 0, column: 0 }],
      links: [],
    });
  });
});
