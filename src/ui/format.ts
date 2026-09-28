import type { EmploymentType, Job, WorkplaceType } from '@/domain/job';

/** Presentation helpers shared by popup and board. */

export const WORKPLACE_LABEL: Record<WorkplaceType, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  casual: 'Casual',
  internship: 'Internship',
  graduate: 'Graduate',
  volunteer: 'Volunteer',
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffSec = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diffSec / 86_400), 'day');
  if (abs < 86_400 * 365) return rtf.format(Math.round(diffSec / (86_400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86_400 * 365)), 'year');
}

export function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  // Date-only strings are calendar dates, not instants — don't shift by timezone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Days until the closing date (negative when closed). */
export function daysUntil(iso: string | undefined, now: Date = new Date()): number | undefined {
  if (!iso) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T23:59:59`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

export const MANUAL_URL_HOST = 'jobtrail.invalid';

export function hasPostingUrl(job: Job): boolean {
  return !job.source.url.includes(MANUAL_URL_HOST);
}

export function matchesQuery(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [job.title, job.company, job.location ?? '', job.notes, job.source.siteName, ...job.tags]
    .join(' ')
    .toLowerCase()
    .includes(q);
}
