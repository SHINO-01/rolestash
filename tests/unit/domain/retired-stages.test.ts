import type { Activity } from '@/domain/job';
import { normalizeJob, normalizeStages } from '@/domain/retired-stages';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import {
  DEFAULT_STAGES,
  captureStages,
  laneStages,
  retiredStageAlias,
  stageName,
  visibleStages,
} from '@/domain/stage';
import { makeJob } from '../helpers/factories';
import { LEGACY_SETTINGS, LEGACY_STAGES } from '../helpers/legacy-stages';

const ids = (stages: readonly { id: string }[]) => stages.map((s) => s.id);

describe('four board lanes (ADR-0034)', () => {
  it('has five lanes, Rejected last, and new jobs never start in Rejected', () => {
    expect(ids(DEFAULT_STAGES)).toEqual(['saved', 'applied', 'interviewing', 'offer', 'rejected']);
    expect(ids(laneStages(DEFAULT_STAGES))).toEqual([
      'saved',
      'applied',
      'interviewing',
      'offer',
      'rejected',
    ]);
    expect(ids(captureStages(DEFAULT_STAGES))).toEqual([
      'saved',
      'applied',
      'interviewing',
      'offer',
    ]);
    expect(ids(visibleStages(DEFAULT_STAGES))).toContain('rejected');
  });

  it('maps retired ids, and names them for old history entries', () => {
    expect(retiredStageAlias('screening')).toBe('interviewing');
    expect(retiredStageAlias('withdrawn')).toBe('rejected');
    expect(retiredStageAlias('applied')).toBeUndefined();
    expect(retiredStageAlias('toString')).toBeUndefined();
    expect(stageName(DEFAULT_STAGES, 'withdrawn')).toBe('Withdrawn');
    expect(stageName(DEFAULT_STAGES, 'applied')).toBe('Applied');
    expect(stageName(DEFAULT_STAGES, 'gone')).toBe('gone');
    expect(stageName(DEFAULT_STAGES, undefined)).toBe('—');
  });
});

describe('normalizeStages', () => {
  it('turns the old seven columns into the new defaults', () => {
    expect(normalizeStages(LEGACY_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps renames, colours and user columns, and moves a retired default column', () => {
    const custom = {
      ...LEGACY_SETTINGS,
      defaultStageId: 'screening',
      stages: [
        ...LEGACY_STAGES.map((s) =>
          s.id === 'applied' ? { ...s, name: 'Sent', color: 'violet' as const } : s,
        ),
        {
          id: 'col-1',
          name: 'Take-home',
          color: 'sky' as const,
          kind: 'active' as const,
          marksApplied: true,
        },
      ],
    };
    const next = normalizeStages(custom);
    expect(ids(next.stages)).toEqual([
      'saved',
      'applied',
      'interviewing',
      'offer',
      'rejected',
      'col-1',
    ]);
    expect(next.stages[1]).toMatchObject({ name: 'Sent', color: 'violet' });
    expect(next.defaultStageId).toBe('interviewing');
  });

  it('brings back the column a retired one maps to if it was missing', () => {
    const next = normalizeStages({
      ...LEGACY_SETTINGS,
      stages: LEGACY_STAGES.filter((s) => s.id !== 'rejected'),
    });
    expect(next.stages.find((s) => s.id === 'rejected')).toMatchObject({ kind: 'lost' });
  });

  it('returns current settings untouched', () => {
    expect(normalizeStages(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
  });
});

describe('normalizeJob', () => {
  const into = (to: string, at: string): Activity => ({
    id: `m-${to}`,
    at,
    type: 'stage_changed',
    fromStageId: 'applied',
    toStageId: to,
  });

  it('moves Screening jobs to Interviewing and keeps their history', () => {
    const job = makeJob({
      stageId: 'screening',
      activity: [into('screening', '2026-09-03T00:00:00.000Z')],
    });
    const next = normalizeJob(job);
    expect(next.stageId).toBe('interviewing');
    expect(next.activity).toEqual(job.activity);
    expect(next.updatedAt).toBe(job.updatedAt);
  });

  it('moves Withdrawn jobs to Rejected with an entry dated when they were withdrawn', () => {
    const job = makeJob({
      id: 'w',
      stageId: 'withdrawn',
      updatedAt: '2026-09-09T00:00:00.000Z',
      activity: [into('withdrawn', '2026-09-05T00:00:00.000Z')],
    });
    const next = normalizeJob(job);
    expect(next.stageId).toBe('rejected');
    expect(next.activity.at(-1)).toEqual({
      id: 'w:withdrawn:2026-09-05T00:00:00.000Z',
      at: '2026-09-05T00:00:00.000Z',
      type: 'stage_changed',
      fromStageId: 'withdrawn',
      toStageId: 'rejected',
    });
    // Idempotent: a second pass (or a second migration run) adds nothing.
    expect(normalizeJob({ ...next, stageId: 'withdrawn' }).activity).toHaveLength(2);
  });

  it('leaves current jobs untouched', () => {
    const job = makeJob({ stageId: 'rejected' });
    expect(normalizeJob(job)).toBe(job);
  });
});
