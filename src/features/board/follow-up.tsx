import clsx from 'clsx';
import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Job, JobPatch } from '@/domain/job';
import { daysUntilClose, followUpInDays, followUpOn, localDay } from '@/domain/reminders';
import { notificationsGranted, requestNotifications } from '@/platform/notifications';
import { formatDate } from '@/ui/format';

const PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
];

/**
 * The drawer's follow-up reminder (Pro; ADR-0015). Setting one for the first
 * time asks for the notifications permission, inside the click that sets it.
 */
export function FollowUp({
  job,
  allowed,
  onPatch,
  onSeePlans,
}: {
  job: Job;
  /** Pro and Advanced, or a build without accounts. */
  allowed: boolean;
  onPatch: (patch: JobPatch) => Promise<void>;
  onSeePlans?: (() => void) | undefined;
}) {
  const [granted, setGranted] = useState<boolean>();
  useEffect(() => {
    void notificationsGranted().then(setGranted);
  }, []);

  if (!allowed) {
    return (
      <p className="text-muted text-[13px]">
        Pro reminds you when it&apos;s time to follow up, and warns you before saved jobs close.{' '}
        {onSeePlans ? (
          <button
            type="button"
            className="text-accent font-medium hover:underline"
            onClick={onSeePlans}
          >
            Try it free
          </button>
        ) : null}
      </p>
    );
  }

  async function set(followUpAt: string | undefined) {
    if (followUpAt && !granted) setGranted(await requestNotifications());
    await onPatch({ followUpAt });
  }

  const now = new Date();
  const due = job.followUpAt ? daysUntilClose(job.followUpAt, now) : undefined;
  return (
    <div className="space-y-2.5">
      {job.followUpAt ? (
        <div className="flex items-center gap-2 text-[13px]">
          <BellRing
            className={clsx(
              'size-4',
              due !== undefined && due <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-accent',
            )}
          />
          <span>
            {due !== undefined && due < 0
              ? `Overdue since ${formatDate(job.followUpAt) ?? ''}`
              : due === 0
                ? 'Follow up today'
                : `Follow up on ${formatDate(job.followUpAt) ?? ''}`}
          </span>
          <button
            type="button"
            aria-label="Clear follow-up"
            className="text-subtle hover:text-ink ml-auto rounded p-1"
            onClick={() => void set(undefined)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => void set(followUpInDays(p.days, now))}
            className="border-line text-muted hover:text-ink hover:border-line-strong h-7 rounded-md border px-2.5 text-xs font-medium"
          >
            {p.label}
          </button>
        ))}
        <label className="border-line text-muted hover:border-line-strong relative h-7 rounded-md border px-2 text-xs font-medium">
          <span className="sr-only">Pick a follow-up date</span>
          <input
            type="date"
            min={localDay(now)}
            value={job.followUpAt ? localDay(new Date(job.followUpAt)) : ''}
            onChange={(e) => {
              const at = followUpOn(e.target.value);
              if (at) void set(at);
            }}
            className="h-full bg-transparent text-xs outline-none"
          />
        </label>
      </div>
      {job.followUpAt && granted === false ? (
        <p className="text-muted text-xs">
          Notifications are off, so this shows on the card only.{' '}
          <button
            type="button"
            className="text-accent font-medium hover:underline"
            onClick={() => void requestNotifications().then(setGranted)}
          >
            Allow notifications
          </button>
        </p>
      ) : null}
    </div>
  );
}
