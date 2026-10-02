import clsx from 'clsx';
import { useMemo, useRef, useState } from 'react';
import type { Journey, JourneyNodeKind } from '@/domain/insights';
import { layoutSankey, type PlacedLink, type PlacedNode } from './sankey-layout';

/**
 * Where applications end up (Pro): a flow chart from Applications through the
 * columns each one reached to how it ended. Progress is the chart colour;
 * endings are neutral grey; every node is labelled, so colour is never the
 * only cue. Flows have a tooltip on hover or focus, and a table for screen
 * readers.
 */

const NODE_FILL: Record<JourneyNodeKind, string> = {
  start: 'fill-chart',
  stage: 'fill-chart',
  won: 'fill-chart',
  ended: 'fill-zinc-400 dark:fill-zinc-500',
  waiting: 'fill-zinc-300 dark:fill-zinc-600',
};

const share = (part: number, whole: number) =>
  whole ? `${String(Math.round((part / whole) * 100))}%` : '0%';

export function JourneyChart({ journey }: { journey: Journey }) {
  const layout = useMemo(() => layoutSankey(journey), [journey]);
  const [hover, setHover] = useState<PlacedLink>();
  // Pointer position in the chart (px); a focused flow uses its middle instead.
  const [at, setAt] = useState<{ x: number; y: number; width: number }>();
  const box = useRef<HTMLDivElement>(null);
  const track = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ x: e.clientX - r.left, y: e.clientY - r.top, width: r.width });
  };
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const kindOf = (id: string) => byId.get(id)?.kind ?? 'stage';
  const x = at ? at.x / Math.max(1, at.width) : hover ? hover.midX / layout.width : 0.5;
  const edge = x < 0.25 ? 'left' : x > 0.75 ? 'right' : 'middle';

  return (
    <div className="relative" ref={box}>
      <svg
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
        className="h-auto w-full"
        role="img"
        aria-label="Where applications end up"
      >
        {layout.links.map((l) => {
          const active = hover === undefined || hover === l;
          const ended = kindOf(l.target) === 'ended' || kindOf(l.target) === 'waiting';
          return (
            <path
              key={`${l.source}>${l.target}`}
              d={l.path}
              className={clsx(
                'cursor-default transition-opacity outline-none',
                ended ? 'fill-zinc-400 dark:fill-zinc-500' : 'fill-chart',
              )}
              opacity={active ? (hover ? 0.55 : 0.3) : 0.12}
              tabIndex={0}
              aria-label={`${label(l.source)} to ${label(l.target)}: ${String(l.value)}`}
              onMouseEnter={(e) => {
                setHover(l);
                track(e);
              }}
              onMouseMove={track}
              onMouseLeave={() => {
                setHover(undefined);
                setAt(undefined);
              }}
              onFocus={() => setHover(l)}
              onBlur={() => setHover(undefined)}
            />
          );
        })}
        {layout.nodes.map((node) => (
          <Node key={node.id} node={node} width={layout.nodeWidth} />
        ))}
      </svg>
      {hover ? (
        <div
          role="tooltip"
          className={clsx(
            'bg-surface border-line shadow-card pointer-events-none absolute -translate-y-full rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap',
            // Kept inside the chart near its edges.
            edge === 'left' ? '' : edge === 'right' ? '-translate-x-full' : '-translate-x-1/2',
          )}
          style={
            at
              ? { left: at.x, top: at.y - 10 }
              : {
                  left: `${String((hover.midX / layout.width) * 100)}%`,
                  top: `${String((hover.midY / layout.height) * 100)}%`,
                }
          }
        >
          <span className="text-muted">
            {label(hover.source)} → {label(hover.target)}:{' '}
          </span>
          <b className="font-semibold">{hover.value}</b>{' '}
          <span className="text-subtle">({share(hover.value, journey.applications)})</span>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>Where applications end up</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Applications</th>
          </tr>
        </thead>
        <tbody>
          {layout.links.map((l) => (
            <tr key={`${l.source}>${l.target}`}>
              <td>{label(l.source)}</td>
              <td>{label(l.target)}</td>
              <td>{l.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The bar, then its count and name to the right, in text colours. */
function Node({ node, width }: { node: PlacedNode; width: number }) {
  const r = Math.min(2, node.height / 2);
  // Kept inside the chart, so a small node at the top isn't clipped.
  const cy = Math.max(node.y + node.height / 2, 14);
  return (
    <g aria-hidden>
      <rect
        x={node.x}
        y={node.y}
        width={width}
        height={node.height}
        rx={r}
        className={NODE_FILL[node.kind]}
      />
      <text x={node.x + width + 6} y={cy - 2} className="fill-ink text-[13px] font-semibold">
        {node.value}
      </text>
      <text x={node.x + width + 6} y={cy + 12} className="fill-muted text-[11px]">
        {node.label}
      </text>
    </g>
  );
}
