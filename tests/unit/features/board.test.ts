import {
  COLUMN_PAGE,
  findColumn,
  groupIntoColumns,
  limitColumns,
  resolveDropIndex,
} from '@/features/board/board-columns';
import { computeStats } from '@/features/board/stats';
import { postingFromDraft, draftFromResult } from '@/features/capture/capture-draft';
import { DEFAULT_STAGES } from '@/domain/stage';
import { daysUntil, hasPostingUrl, matchesQuery, postingHref, relativeTime } from '@/ui/format';
import { makeJob, makeResult } from '../helpers/factories';

describe('board columns', () => {
  it('groups by stage in rank order and rescues orphaned stages', () => {
    const jobs = [
      makeJob({ id: 'b', stageId: 'saved', rank: 2 }),
      makeJob({ id: 'a', stageId: 'saved', rank: 1 }),
      makeJob({ id: 'o', stageId: 'deleted-stage', rank: 3 }),
      makeJob({ id: 'x', stageId: 'offer', rank: 1 }),
    ];
    const cols = groupIntoColumns(DEFAULT_STAGES, jobs, 'saved');
    expect(cols.saved).toEqual(['a', 'b', 'o']);
    expect(cols.offer).toEqual(['x']);
    expect(cols.applied).toEqual([]);
    expect(findColumn(cols, 'x')).toBe('offer');
    expect(findColumn(cols, 'applied')).toBe('applied');
    expect(findColumn(cols, 'missing')).toBeUndefined();
  });

  it('gives lost columns no lane (ADR-0034)', () => {
    const jobs = [
      makeJob({ id: 'r', stageId: 'rejected' }),
      makeJob({ id: 'i', stageId: 'interviewing' }),
    ];
    const cols = groupIntoColumns(DEFAULT_STAGES, jobs, 'saved');
    expect(Object.keys(cols)).toEqual(['saved', 'applied', 'interviewing', 'offer']);
    expect(Object.values(cols).flat()).toEqual(['i']);
  });

  it('maps a drop in a filtered column to the right index among all jobs', () => {
    // Full column: a b c d (b and c hidden by a search filter).
    const all = ['a', 'b', 'c', 'd'].map((id, i) => makeJob({ id, rank: i + 1 }));
    // User drops "x" between visible a and d → lands before d (after hidden b, c).
    expect(resolveDropIndex(all, 'x', 'a', 'd')).toBe(3);
    expect(resolveDropIndex(all, 'x', undefined, 'a')).toBe(0);
    expect(resolveDropIndex(all, 'x', 'd', undefined)).toBe(4);
    expect(resolveDropIndex(all, 'x', undefined, undefined)).toBe(4);
    // Moving an existing job ignores itself.
    expect(resolveDropIndex(all, 'a', 'c', 'd')).toBe(2);
  });

  it('shows the first cards of long columns, and drops below them land where you see them', () => {
    const ids = Array.from({ length: COLUMN_PAGE + 10 }, (_, i) => `j${String(i)}`);
    const cols = { saved: ids, applied: ['x'] };
    const shown = limitColumns(cols, {});
    expect(shown.saved).toEqual(ids.slice(0, COLUMN_PAGE));
    expect(shown.applied).toEqual(['x']);
    expect(limitColumns(cols, { saved: COLUMN_PAGE * 2 }).saved).toEqual(ids);
    // Dropped under the last card shown: right after it, before the hidden ones.
    const all = ids.map((id, i) => makeJob({ id, rank: i + 1 }));
    expect(resolveDropIndex(all, 'x', shown.saved?.at(-1), undefined)).toBe(COLUMN_PAGE);
  });
});

describe('stats', () => {
  it('counts active, recent applications, interviews and offers', () => {
    const now = new Date('2026-09-28T00:00:00Z').getTime();
    const jobs = [
      makeJob({ stageId: 'saved' }),
      makeJob({ stageId: 'applied', appliedAt: '2026-09-25T00:00:00.000Z' }),
      makeJob({ stageId: 'interviewing', appliedAt: '2026-09-01T00:00:00.000Z' }),
      makeJob({ stageId: 'offer' }),
      makeJob({ stageId: 'rejected' }),
    ];
    expect(computeStats(jobs, DEFAULT_STAGES, now)).toEqual({
      active: 3,
      appliedThisWeek: 1,
      interviewing: 1,
      offers: 1,
    });
  });
});

describe('capture form mapping', () => {
  it('keeps structured salary when untouched and re-parses edits', () => {
    const result = makeResult({
      fields: {
        title: 'Dev',
        salary: { min: 100000, max: 120000, currency: 'AUD', period: 'year' },
      },
    });
    const draft = draftFromResult(result, 'saved');
    expect(postingFromDraft(draft, result).salary).toEqual(result.fields.salary);
    const edited = postingFromDraft({ ...draft, salaryText: '$130k' }, result);
    expect(edited.salary).toMatchObject({ min: 130000, currency: 'AUD' });
    expect(postingFromDraft({ ...draft, salaryText: '' }, result).salary).toBeUndefined();
  });

  it('never saves an empty title', () => {
    const draft = draftFromResult(makeResult({ fields: {} }), 'saved');
    expect(postingFromDraft(draft).title).toBe('Untitled position');
  });
});

describe('format helpers', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  it('relative time', () => {
    expect(relativeTime('2026-09-28T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-09-25T12:00:00Z', now)).toBe('3 days ago');
  });
  it('days until closing', () => {
    expect(daysUntil('2026-10-05T12:00:00Z', now)).toBe(7);
    expect(daysUntil(undefined, now)).toBeUndefined();
  });
  it('search matches title, company, tags and notes', () => {
    const job = makeJob({
      title: 'Platform Engineer',
      company: 'Canva',
      tags: ['dream'],
      notes: 'ask Priya',
    });
    for (const q of ['platform', 'CANVA', 'dream', 'priya', ''])
      expect(matchesQuery(job, q)).toBe(true);
    expect(matchesQuery(job, 'google')).toBe(false);
  });
  it('knows manual jobs have no posting URL', () => {
    expect(hasPostingUrl(makeJob())).toBe(true);
    expect(
      hasPostingUrl(
        makeJob({ source: { ...makeJob().source, url: 'https://rolestash.invalid/manual/1' } }),
      ),
    ).toBe(false);
    // Manual jobs saved before the rename keep the legacy placeholder host.
    expect(
      hasPostingUrl(
        makeJob({ source: { ...makeJob().source, url: 'https://jobtrail.invalid/manual/1' } }),
      ),
    ).toBe(false);
  });
  it('opens only http(s) posting links, preferring the apply link', () => {
    const job = makeJob();
    expect(postingHref(job)).toBe(job.source.url);
    expect(postingHref(makeJob({ applyUrl: 'https://apply.example/1' }))).toBe(
      'https://apply.example/1',
    );
    // Stored before the extractor checked the scheme, or synced from elsewhere.
    expect(postingHref(makeJob({ applyUrl: 'javascript:alert(1)' }))).toBe(job.source.url);
    expect(
      postingHref(makeJob({ source: { ...job.source, url: 'javascript:alert(1)' } })),
    ).toBeUndefined();
  });
});
