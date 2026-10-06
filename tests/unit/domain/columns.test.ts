import {
  addStage,
  archiveStage,
  MAX_STAGES,
  moveStage,
  recolorStage,
  renameStage,
  restoreStage,
  setDefaultStage,
  type ColumnResult,
} from '@/domain/columns';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/settings';
import { visibleStages, type StageColor } from '@/domain/stage';
import { makeJob } from '../helpers/factories';

const base: Settings = structuredClone(DEFAULT_SETTINGS);
const ids = (s: Settings) => s.stages.map((x) => x.id);
function settingsOf(result: ColumnResult): Settings {
  if (!result.ok) throw new Error(result.reason);
  return result.settings;
}
const reason = (result: ColumnResult) => (result.ok ? undefined : result.reason);

describe('custom columns', () => {
  it('renames, trimming, and refuses blanks and duplicates', () => {
    expect(settingsOf(renameStage(base, 'saved', '  Wishlist ')).stages[0]?.name).toBe('Wishlist');
    expect(reason(renameStage(base, 'saved', '   '))).toMatch(/name/);
    expect(reason(renameStage(base, 'saved', 'applied'))).toMatch(/already a column/);
    expect(renameStage(base, 'saved', 'Saved').ok).toBe(true); // its own name
    expect(reason(renameStage(base, 'saved', 'x'.repeat(41)))).toMatch(/40/);
  });

  it('recolours with known colours only', () => {
    expect(settingsOf(recolorStage(base, 'saved', 'rose')).stages[0]?.color).toBe('rose');
    expect(recolorStage(base, 'saved', 'pink' as StageColor).ok).toBe(false);
  });

  it('moves a column among the visible ones, stopping at the ends', () => {
    expect(ids(settingsOf(moveStage(base, 'applied', -1))).slice(0, 2)).toEqual([
      'applied',
      'saved',
    ]);
    expect(ids(settingsOf(moveStage(base, 'saved', -1)))).toEqual(ids(base));
    const hidden = settingsOf(archiveStage(base, 'applied', []));
    // Skips the archived Applied column.
    expect(ids(settingsOf(moveStage(hidden, 'interviewing', -1))).slice(0, 3)).toEqual([
      'interviewing',
      'applied',
      'saved',
    ]);
  });

  it('adds in-progress columns before the finished ones, and finished ones last', () => {
    const one = settingsOf(
      addStage(base, { name: 'Take-home', color: 'sky', kind: 'active', marksApplied: true }, 'c1'),
    );
    expect(ids(one).indexOf('c1')).toBe(ids(base).indexOf('interviewing') + 1);
    const two = settingsOf(
      addStage(one, { name: 'Ghosted', color: 'zinc', kind: 'lost', marksApplied: false }, 'c2'),
    );
    expect(ids(two).at(-1)).toBe('c2');
    expect(two.stages.at(-1)?.marksApplied).toBe(true); // finished columns count as applied
    expect(
      reason(
        addStage(base, { name: 'Offer', color: 'sky', kind: 'active', marksApplied: false }, 'x'),
      ),
    ).toMatch(/already/);
  });

  it('caps the number of columns', () => {
    let s = base;
    for (let i = s.stages.length; i < MAX_STAGES; i++)
      s = settingsOf(
        addStage(
          s,
          { name: `C${String(i)}`, color: 'sky', kind: 'active', marksApplied: false },
          `c${String(i)}`,
        ),
      );
    expect(
      reason(
        addStage(s, { name: 'One more', color: 'sky', kind: 'active', marksApplied: false }, 'z'),
      ),
    ).toMatch(/up to 20/);
  });

  it('archives only empty, non-default columns, and keeps one on the board', () => {
    const jobs = [
      makeJob({ stageId: 'applied' }),
      makeJob({ stageId: 'interviewing', archivedAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(reason(archiveStage(base, 'applied', jobs))).toMatch(/Move or archive the 1 job/);
    expect(reason(archiveStage(base, 'saved', []))).toMatch(/Choose another column for new jobs/);
    const archived = settingsOf(archiveStage(base, 'interviewing', jobs)); // only an archived job there
    expect(visibleStages(archived.stages).map((s) => s.id)).not.toContain('interviewing');
    expect(
      settingsOf(restoreStage(archived, 'interviewing')).stages.find(
        (s) => s.id === 'interviewing',
      ),
    ).not.toHaveProperty('archived');

    let only = base;
    for (const s of base.stages.slice(1)) only = settingsOf(archiveStage(only, s.id, []));
    expect(reason(setDefaultStage(only, 'applied'))).toMatch(/on the board/);
    const lastOne = settingsOf(
      setDefaultStage(settingsOf(restoreStage(only, 'applied')), 'applied'),
    );
    expect(
      reason(archiveStage(settingsOf(archiveStage(lastOne, 'saved', [])), 'applied', [])),
    ).toMatch(/Choose another/);
  });
});
