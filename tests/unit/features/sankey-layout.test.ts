import { journey } from '@/domain/insights';
import { DEFAULT_STAGES } from '@/domain/stage';
import type { Activity } from '@/domain/job';
import { layoutSankey } from '@/features/insights/sankey-layout';
import { makeJob } from '../helpers/factories';

const now = new Date('2026-10-02T12:00:00');
const ago = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const move = (from: string, to: string, n: number): Activity => ({
  id: `${from}-${to}-${String(n)}`,
  at: ago(n),
  type: 'stage_changed',
  fromStageId: from,
  toStageId: to,
});

const jobs = [
  ...Array.from({ length: 6 }, (_, i) =>
    makeJob({
      id: `r${String(i)}`,
      stageId: 'rejected',
      appliedAt: ago(30),
      activity: [move('applied', 'rejected', 20)],
    }),
  ),
  ...Array.from({ length: 3 }, (_, i) =>
    makeJob({
      id: `s${String(i)}`,
      stageId: 'interviewing',
      appliedAt: ago(30),
      activity: [move('applied', 'interviewing', 20)],
    }),
  ),
  makeJob({ id: 'w', stageId: 'applied', appliedAt: ago(2) }),
];

describe('journey layout', () => {
  const layout = layoutSankey(journey(jobs, DEFAULT_STAGES, now));
  const node = (id: string) => layout.nodes.find((n) => n.id === id);

  it('sizes nodes by applications and keeps every column inside the chart', () => {
    expect(node('applications')?.height).toBeCloseTo(200);
    expect(node('outcome:rejected')?.height).toBeCloseTo(120);
    for (const n of layout.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
      expect(n.x + layout.nodeWidth).toBeLessThanOrEqual(layout.width);
    }
  });

  it('puts columns left to right, with outcomes last', () => {
    const xs = ['applications', 'interviewing'].map((id) => node(id)?.x ?? -1);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(node('outcome:rejected')?.x).toBeGreaterThan(node('interviewing')?.x ?? Infinity);
  });

  it('stacks the bands leaving a node without gaps or overlaps', () => {
    const leaving = layout.links.filter((l) => l.source === 'applications');
    const tops = leaving.map((l) => Number(/^M[\d.]+,([\d.]+)/.exec(l.path)?.[1]));
    // Interviewing sits above the outcomes, so its band leaves first.
    expect(leaving[0]?.target).toBe('interviewing');
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(tops.length);
  });
});
