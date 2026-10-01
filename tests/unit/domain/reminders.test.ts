import {
  closesIn,
  closingSoon,
  daysUntilClose,
  digestDue,
  dueFollowUps,
  followUpInDays,
  followUpOn,
  localDay,
  pruneNotified,
} from '@/domain/reminders';
import { DEFAULT_STAGES } from '@/domain/stage';
import { makeJob } from '../helpers/factories';

// Local times, so the tests hold in any time zone.
const NOW = new Date(2026, 9, 1, 10, 0); // 1 Oct 2026, 10:00 local
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString();

describe('follow-ups', () => {
  const jobs = [
    makeJob({ id: 'due', followUpAt: at(1, 9) }),
    makeJob({ id: 'later', followUpAt: at(2) }),
    makeJob({ id: 'none' }),
    makeJob({ id: 'archived', followUpAt: at(1, 8), archivedAt: at(1, 8) }),
  ];

  it('are due once their time has passed, and only once per date', () => {
    expect(dueFollowUps(jobs, { notified: {} }, NOW).map((j) => j.id)).toEqual(['due']);
    expect(dueFollowUps(jobs, { notified: { due: at(1, 9) } }, NOW)).toEqual([]);
    // Moving the date re-arms it.
    expect(dueFollowUps(jobs, { notified: { due: at(30, 9) } }, NOW)).toHaveLength(1);
  });

  it('forgets notified entries for deleted jobs or changed dates', () => {
    const state = { notified: { due: at(1, 9), gone: at(1, 9), later: at(30) } };
    expect(pruneNotified(state, jobs).notified).toEqual({ due: at(1, 9) });
  });

  it('are set at 9:00 local time', () => {
    expect(followUpInDays(3, NOW)).toBe(at(4));
    expect(followUpOn('2026-10-20')).toBe(at(20));
    expect(followUpOn('20 Oct')).toBeUndefined();
  });
});

describe('closing soon', () => {
  const jobs = [
    makeJob({ id: 'today', closesAt: '2026-10-01' }),
    makeJob({ id: 'in3', closesAt: '2026-10-04' }),
    makeJob({ id: 'in4', closesAt: '2026-10-05' }),
    makeJob({ id: 'closed', closesAt: '2026-09-30' }),
    makeJob({ id: 'applied', closesAt: '2026-10-02', stageId: 'applied', appliedAt: at(1) }),
    makeJob({ id: 'archived', closesAt: '2026-10-02', archivedAt: at(1) }),
    makeJob({ id: 'instant', closesAt: at(2, 17) }),
  ];

  it('lists unapplied jobs closing within 3 days, soonest first', () => {
    expect(closingSoon(jobs, DEFAULT_STAGES, NOW).map((j) => j.id)).toEqual([
      'today',
      'instant',
      'in3',
    ]);
  });

  it('counts calendar days and says them plainly', () => {
    expect(daysUntilClose('2026-10-01', NOW)).toBe(0);
    expect(daysUntilClose(at(2, 23), NOW)).toBe(1);
    expect([0, 1, 3].map(closesIn)).toEqual(['today', 'tomorrow', 'in 3 days']);
  });

  it('sends the digest once a day, from 9:00', () => {
    expect(digestDue({ notified: {} }, NOW)).toBe(true);
    expect(digestDue({ notified: {}, lastDigest: localDay(NOW) }, NOW)).toBe(false);
    expect(digestDue({ notified: {} }, new Date(2026, 9, 1, 8, 59))).toBe(false);
  });
});
