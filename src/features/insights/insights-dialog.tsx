import { useMemo, useState } from 'react';
import {
  applicationsPerWeek,
  appliedWithin,
  bySource,
  funnel,
  type FunnelStep,
  journey,
  NO_REPLY_DAYS,
  replies,
  type WeekCount,
} from '@/domain/insights';
import { JourneyChart } from './journey-chart';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { Button } from '@/ui/components/button';
import { Dialog } from '@/ui/components/overlay';

/**
 * Insights (Pro and up): applications per week, how far applications get,
 * replies and sources. Worked out on this device; nothing is tracked.
 */
export function InsightsDialog({
  open,
  onClose,
  jobs,
  stages,
  allowed,
  onSeePlans,
}: {
  open: boolean;
  onClose: () => void;
  jobs: readonly Job[];
  stages: readonly Stage[];
  allowed: boolean;
  onSeePlans?: (() => void) | undefined;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Insights"
      description="How your search is going, worked out on this device from your board."
      className="w-[min(760px,calc(100vw-2rem))]"
    >
      {!open ? null : allowed ? (
        <InsightsBody jobs={jobs} stages={stages} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted text-sm">
            Insights are part of Pro: applications per week, how far your applications get, how
            quickly employers reply, and which job sites work best for you.
          </p>
          {onSeePlans ? (
            <Button variant="primary" className="self-start" onClick={onSeePlans}>
              See plans
            </Button>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

const percent = (rate: number) => `${String(Math.round(rate * 100))}%`;
const dayCount = (days: number) => {
  const n = Math.round(days);
  return n === 1 ? '1 day' : `${String(n)} days`;
};

function InsightsBody({ jobs, stages }: { jobs: readonly Job[]; stages: readonly Stage[] }) {
  const now = useMemo(() => new Date(), []);
  const weeks = useMemo(() => applicationsPerWeek(jobs, now), [jobs, now]);
  const steps = useMemo(() => funnel(jobs, stages), [jobs, stages]);
  const reply = useMemo(() => replies(jobs, now), [jobs, now]);
  const sources = useMemo(() => bySource(jobs, stages), [jobs, stages]);
  const recent = useMemo(() => appliedWithin(jobs, now, 30), [jobs, now]);
  const paths = useMemo(() => journey(jobs, stages, now), [jobs, stages, now]);
  const offers =
    steps.find((s) => stages.find((x) => x.id === s.stageId)?.kind === 'won')?.count ?? 0;

  if (reply.applications === 0)
    return (
      <p className="text-muted text-sm">
        Insights appear once you’ve applied to a few jobs. Moving a card to Applied (or later)
        counts as applying.
      </p>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Applied in the last 30 days" value={String(recent)} />
        <Stat
          label="Got a reply"
          value={percent(reply.rate)}
          detail={`${String(reply.replied)} of ${String(reply.applications)}`}
        />
        <Stat
          label="Typical wait for a reply"
          value={reply.medianDays === undefined ? '—' : dayCount(reply.medianDays)}
          detail="median"
        />
        <Stat label="Offers" value={String(offers)} />
      </div>

      <Section title="Applications per week" note="Last 12 weeks">
        <WeeklyChart weeks={weeks} />
      </Section>

      <Section title="How far applications get" note="Including jobs that moved on to Rejected">
        <Funnel steps={steps} />
        {reply.unanswered ? (
          <p className="text-muted mt-3 text-[13px]">
            {reply.unanswered} {reply.unanswered === 1 ? 'application has' : 'applications have'}{' '}
            had no reply for over {NO_REPLY_DAYS} days. A follow-up can help.
          </p>
        ) : null}
      </Section>

      <Section title="Where applications end up" note="Hover a flow for its share">
        <JourneyChart journey={paths} />
      </Section>

      <Section title="By source">
        <table className="w-full text-left text-[13px] tabular-nums">
          <thead className="text-subtle text-xs">
            <tr className="border-line border-b">
              <th scope="col" className="py-2 font-medium">
                Found on
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Applied
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Replied
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Interviews
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Offers
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row.source} className="border-line border-b last:border-0">
                <th scope="row" className="py-2 font-medium">
                  {row.source}
                </th>
                <td className="py-2 text-right">{row.applications}</td>
                <td className="text-muted py-2 text-right">
                  {percent(row.replied / row.applications)}
                </td>
                <td className="text-muted py-2 text-right">{row.interviews}</td>
                <td className="text-muted py-2 text-right">{row.offers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <p className="text-subtle text-xs">
        Worked out on this device from your board, including archived jobs. Nothing is tracked or
        sent.
      </p>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-surface-2/60 rounded-xl p-3">
      <p className="text-muted text-xs">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {detail ? <p className="text-subtle text-xs">{detail}</p> : null}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {note ? <span className="text-subtle text-xs">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

const weekLabel = (week: string) =>
  new Date(`${week}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Columns, one per week: ≤24px wide, 4px rounded tops, a hairline grid, a tooltip on hover or focus. */
function WeeklyChart({ weeks }: { weeks: readonly WeekCount[] }) {
  const [hover, setHover] = useState<number>();
  const W = 680;
  const H = 160;
  const PAD = { top: 12, bottom: 22, left: 28, right: 4 };
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const band = (W - PAD.left - PAD.right) / weeks.length;
  const barW = Math.min(24, band - 6);
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / top);
  const base = y(0);
  const hovered = hover === undefined ? undefined : weeks[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="h-auto w-full"
        role="img"
        aria-label="Applications per week, last 12 weeks"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-subtle text-[10px]"
            >
              {t}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = PAD.left + band * i + (band - barW) / 2;
          const h = base - y(w.count);
          const r = Math.min(4, h);
          return (
            <g key={w.week}>
              {w.count > 0 ? (
                <path
                  d={`M${String(x)},${String(base)} V${String(base - h + r)} Q${String(x)},${String(base - h)} ${String(x + r)},${String(base - h)} H${String(x + barW - r)} Q${String(x + barW)},${String(base - h)} ${String(x + barW)},${String(base - h + r)} V${String(base)} Z`}
                  className="fill-chart"
                  opacity={hover === undefined || hover === i ? 1 : 0.55}
                />
              ) : null}
              {i % 2 === weeks.length % 2 || i === weeks.length - 1 ? (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-subtle text-[10px]"
                >
                  {i === weeks.length - 1 ? 'This week' : weekLabel(w.week)}
                </text>
              ) : null}
              {/* The hit target is the whole band, bigger than the column. */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={base - PAD.top}
                fill="transparent"
                tabIndex={0}
                aria-label={`Week of ${weekLabel(w.week)}: ${String(w.count)} applications`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(undefined)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(undefined)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== undefined ? (
        <div
          role="tooltip"
          className="bg-surface border-line shadow-card pointer-events-none absolute -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap"
          style={{ left: `${String(((PAD.left + band * hover + band / 2) / W) * 100)}%`, top: 0 }}
        >
          <span className="text-muted">Week of {weekLabel(hovered.week)}: </span>
          <b className="font-semibold">{hovered.count}</b>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>Applications per week</caption>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week}>
              <th scope="row">Week of {weekLabel(w.week)}</th>
              <td>{w.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One bar per step, its count and share at the tip. */
function Funnel({ steps }: { steps: readonly FunnelStep[] }) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="How far applications get">
      {steps.map((s) => (
        <li key={s.stageId} className="grid grid-cols-[7rem_1fr] items-center gap-3 text-[13px]">
          <span className="text-muted truncate">{s.name}</span>
          <span className="flex items-center gap-2">
            <span
              className="bg-chart h-3 rounded-r-[4px]"
              style={{ width: `calc(${String(s.rate * 100)}% * 0.8)`, minWidth: s.count ? 4 : 0 }}
            />
            <span className="tabular-nums">
              <b className="font-semibold">{s.count}</b>{' '}
              <span className="text-subtle">· {percent(s.rate)}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
