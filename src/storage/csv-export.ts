import { isManualUrl, type Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';

/**
 * CSV export (every plan, ADR-0013): one row per job, for spreadsheets. The
 * JSON backup stays the lossless format; this one is for reading and
 * filtering, so values are flattened and dates are local calendar dates.
 *
 * Safe to open in Excel, Numbers and Google Sheets:
 *  - UTF-8 with a byte-order mark, CRLF line endings (RFC 4180);
 *  - cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR)
 *    are prefixed with an apostrophe, so a posting can't inject one;
 *  - text is cut to Excel's 32,767-character cell limit.
 */

/** Excel's per-cell limit, minus room for the formula guard. */
const MAX_CELL = 32_000;
const PRIORITY = ['', 'Low', 'Medium', 'High'] as const;
const WORKPLACE = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' } as const;

interface Column {
  header: string;
  value: (job: Job, stages: ReadonlyMap<string, Stage>) => string | number | undefined;
}

/** A local calendar date (YYYY-MM-DD) for an ISO instant; date-only values pass through. */
export function localDate(iso: string | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const COLUMNS: readonly Column[] = [
  { header: 'Title', value: (j) => j.title },
  { header: 'Company', value: (j) => j.company },
  { header: 'Stage', value: (j, stages) => stages.get(j.stageId)?.name ?? j.stageId },
  { header: 'Priority', value: (j) => PRIORITY[j.priority] },
  { header: 'Location', value: (j) => j.location },
  { header: 'Workplace', value: (j) => j.workplaceType && WORKPLACE[j.workplaceType] },
  { header: 'Employment', value: (j) => j.employmentTypes.join(', ') },
  { header: 'Salary min', value: (j) => j.salary?.min },
  { header: 'Salary max', value: (j) => j.salary?.max },
  { header: 'Currency', value: (j) => j.salary?.currency },
  { header: 'Salary period', value: (j) => j.salary?.period },
  { header: 'Salary (as posted)', value: (j) => j.salary?.text },
  { header: 'Tags', value: (j) => j.tags.join(', ') },
  { header: 'Closes', value: (j) => localDate(j.closesAt) },
  { header: 'Posted', value: (j) => localDate(j.postedAt) },
  { header: 'Saved', value: (j) => localDate(j.createdAt) },
  { header: 'Applied', value: (j) => localDate(j.appliedAt) },
  { header: 'Last updated', value: (j) => localDate(j.updatedAt) },
  {
    header: 'Contacts',
    value: (j) =>
      (j.contacts ?? [])
        .map((c) => [c.name, c.role, c.email].filter(Boolean).join(', '))
        .join('; '),
  },
  {
    header: 'Interview rounds',
    value: (j) =>
      (j.rounds ?? [])
        .map((r) => [r.kind, localDate(r.at), r.with].filter(Boolean).join(' '))
        .join('; '),
  },
  { header: 'Documents', value: (j) => (j.documents ?? []).map((d) => d.name).join('; ') },
  { header: 'Posting link', value: (j) => (isManualUrl(j.source.url) ? '' : j.source.url) },
  { header: 'Apply link', value: (j) => j.applyUrl },
  {
    header: 'Source',
    value: (j) => (isManualUrl(j.source.url) ? 'Added by hand' : j.source.siteName),
  },
  { header: 'Notes', value: (j) => j.notes },
  { header: 'Description', value: (j) => j.description },
];

export function csvCell(value: string | number | undefined): string {
  if (value === undefined) return '';
  let text = String(value);
  if (text.length > MAX_CELL) text = `${text.slice(0, MAX_CELL)}…`;
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Jobs in board order: by stage, then by rank within the stage. */
function boardOrder(jobs: readonly Job[], stages: readonly Stage[]): Job[] {
  const index = new Map(stages.map((s, i) => [s.id, i]));
  const at = (j: Job) => index.get(j.stageId) ?? stages.length;
  return [...jobs].sort((a, b) => at(a) - at(b) || a.rank - b.rank);
}

export function jobsToCsv(jobs: readonly Job[], stages: readonly Stage[]): string {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const rows = [
    COLUMNS.map((c) => csvCell(c.header)),
    ...boardOrder(jobs, stages).map((job) => COLUMNS.map((c) => csvCell(c.value(job, byId)))),
  ];
  return `\uFEFF${rows.map((r) => r.join(',')).join('\r\n')}\r\n`;
}
