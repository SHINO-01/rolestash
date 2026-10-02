import type { Journey, JourneyLink, JourneyNode } from '@/domain/insights';

/**
 * Geometry for the journey chart: node bars in columns, and flows as bands
 * whose thickness is the number of applications. Pure, so it's unit-tested.
 */

export interface PlacedNode extends JourneyNode {
  x: number;
  y: number;
  height: number;
}

export interface PlacedLink extends JourneyLink {
  /** A closed band: top curve out, bottom curve back. */
  path: string;
  /** Where to anchor a tooltip (the band's middle). */
  midX: number;
  midY: number;
}

export interface SankeyLayout {
  width: number;
  height: number;
  nodeWidth: number;
  nodes: PlacedNode[];
  links: PlacedLink[];
}

const PAD = { top: 8, bottom: 8, left: 4, right: 150 };
const NODE_WIDTH = 10;
/** Room for a node's two-line label, so small nodes don't overlap. */
const MIN_SLOT = 30;
const GAP = 10;
/** The tallest column's nodes add up to this many pixels. */
const FLOW_HEIGHT = 200;

const n = (v: number) => String(Math.round(v * 10) / 10);

export function layoutSankey(journey: Journey, width = 680): SankeyLayout {
  const columns = Math.max(1, ...journey.nodes.map((node) => node.column + 1));
  const perColumn = Array.from({ length: columns }, (_, c) =>
    journey.nodes.filter((node) => node.column === c),
  );
  const biggest = Math.max(1, ...perColumn.map((col) => col.reduce((s, x) => s + x.value, 0)));
  const k = FLOW_HEIGHT / biggest;
  const step = columns > 1 ? (width - PAD.left - PAD.right - NODE_WIDTH) / (columns - 1) : 0;

  const placed = new Map<string, PlacedNode>();
  let height = 0;
  perColumn.forEach((col, c) => {
    let y = PAD.top;
    for (const node of col) {
      const h = Math.max(2, node.value * k);
      placed.set(node.id, { ...node, x: PAD.left + c * step, y, height: h });
      y += Math.max(h, MIN_SLOT) + GAP;
    }
    height = Math.max(height, y - GAP + PAD.bottom);
  });

  // Bands leave each node top-down in the order of their targets, and arrive
  // top-down in the order of their sources, so they don't cross at the ends.
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  // Nearer columns first when two nodes sit at the same height.
  const rank = (id: string) => (placed.get(id)?.y ?? 0) * 100 + (placed.get(id)?.column ?? 0);
  const yOf = (id: string) => placed.get(id)?.y ?? 0;
  const sorted = [...journey.links].sort(
    (a, b) => rank(a.source) - rank(b.source) || rank(a.target) - rank(b.target),
  );
  const inOrder = [...sorted].sort(
    (a, b) => rank(a.target) - rank(b.target) || rank(a.source) - rank(b.source),
  );
  const start = new Map<JourneyLink, number>();
  const end = new Map<JourneyLink, number>();
  for (const l of sorted) {
    const offset = out.get(l.source) ?? 0;
    start.set(l, yOf(l.source) + offset);
    out.set(l.source, offset + l.value * k);
  }
  for (const l of inOrder) {
    const offset = into.get(l.target) ?? 0;
    end.set(l, yOf(l.target) + offset);
    into.set(l.target, offset + l.value * k);
  }

  const links: PlacedLink[] = sorted.map((l) => {
    const s = placed.get(l.source);
    const t = placed.get(l.target);
    const x0 = (s?.x ?? 0) + NODE_WIDTH;
    const x1 = t?.x ?? 0;
    const y0 = start.get(l) ?? 0;
    const y1 = end.get(l) ?? 0;
    const w = l.value * k;
    const mx = (x0 + x1) / 2;
    const path =
      `M${n(x0)},${n(y0)} C${n(mx)},${n(y0)} ${n(mx)},${n(y1)} ${n(x1)},${n(y1)} ` +
      `V${n(y1 + w)} C${n(mx)},${n(y1 + w)} ${n(mx)},${n(y0 + w)} ${n(x0)},${n(y0 + w)} Z`;
    return { ...l, path, midX: mx, midY: (y0 + y1 + w) / 2 };
  });

  return { width, height, nodeWidth: NODE_WIDTH, nodes: [...placed.values()], links };
}
