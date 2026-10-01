import { z } from 'zod';

/**
 * The Job aggregate. Zod schemas are the single source of truth: TypeScript
 * types are inferred from them, and the same schemas validate backups on
 * import and data during storage migrations.
 *
 * Changing a schema in a way that invalidates stored data REQUIRES a storage
 * migration — see docs/reference/storage.md.
 */

const IsoDateTime = z.iso.datetime({ offset: true });
/** Dates from postings are often date-only; we accept both forms. */
const IsoDateOrDateTime = z.union([z.iso.date(), IsoDateTime]);

/**
 * Manual jobs without a link get a placeholder URL on this reserved host.
 * Jobs created before the rename to Rolestash use the legacy host; both stay
 * recognised because the URL is stored on every job.
 */
export const MANUAL_URL_HOST = 'rolestash.invalid';
const LEGACY_MANUAL_URL_HOSTS = ['jobtrail.invalid'];

export function isManualUrl(url: string): boolean {
  return [MANUAL_URL_HOST, ...LEGACY_MANUAL_URL_HOSTS].some((host) => url.includes(host));
}

export const SALARY_PERIODS = ['hour', 'day', 'week', 'month', 'year'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const SalarySchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  /** ISO 4217 code when known (e.g. "AUD"). Left empty rather than guessed. */
  currency: z.string().length(3).optional(),
  period: z.enum(SALARY_PERIODS).optional(),
  /** Human-readable text as shown on the posting; always kept when available. */
  text: z.string().max(200).optional(),
});
export type Salary = z.infer<typeof SalarySchema>;

export const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'temporary',
  'casual',
  'internship',
  'graduate',
  'volunteer',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PRIORITIES = [0, 1, 2, 3] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Facts about the posting itself — what the extractor can fill in. */
export const PostingSchema = z.object({
  title: z.string().min(1).max(300),
  company: z.string().max(200),
  location: z.string().max(300).optional(),
  workplaceType: z.enum(WORKPLACE_TYPES).optional(),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
  salary: SalarySchema.optional(),
  postedAt: IsoDateOrDateTime.optional(),
  closesAt: IsoDateOrDateTime.optional(),
  /** Plain-text snapshot of the description (never HTML — see ADR-0005). */
  description: z.string().max(100_000).optional(),
  /** The site's own identifier for the posting, when discoverable. */
  externalId: z.string().max(200).optional(),
  applyUrl: z.url().optional(),
});
export type Posting = z.infer<typeof PostingSchema>;

export const JobSourceSchema = z.object({
  /** Canonical URL used for duplicate detection. */
  url: z.url(),
  /** The URL exactly as it was in the tab when captured. */
  originalUrl: z.url(),
  /** Adapter id (e.g. "linkedin") or "generic" / "manual". */
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  capturedAt: IsoDateTime,
});
export type JobSource = z.infer<typeof JobSourceSchema>;

export const ACTIVITY_TYPES = [
  'created',
  'stage_changed',
  'edited',
  'archived',
  'unarchived',
] as const;

export const ActivitySchema = z.object({
  id: z.string().min(1),
  at: IsoDateTime,
  type: z.enum(ACTIVITY_TYPES),
  fromStageId: z.string().optional(),
  toStageId: z.string().optional(),
  /** For `edited`: which fields changed. */
  fields: z.array(z.string()).optional(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const ExtractionMetaSchema = z.object({
  /** Overall 0..1 confidence reported by the extractor. */
  confidence: z.number().min(0).max(1),
  /** Which strategy produced each field — invaluable when debugging adapters. */
  provenance: z.record(z.string(), z.string()),
  extractorVersion: z.string(),
});
export type ExtractionMeta = z.infer<typeof ExtractionMetaSchema>;

export const JobSchema = PostingSchema.extend({
  id: z.string().min(1),
  stageId: z.string().min(1),
  /** Sort key within a stage (fractional ranking — see ADR-0006). */
  rank: z.number(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  tags: z.array(z.string().min(1).max(40)).max(30).default([]),
  notes: z.string().max(50_000).default(''),
  source: JobSourceSchema,
  extraction: ExtractionMetaSchema.optional(),
  activity: z.array(ActivitySchema).default([]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  appliedAt: IsoDateTime.optional(),
  /** When to remind the user to follow up (Pro; ADR-0015). */
  followUpAt: IsoDateTime.optional(),
  /** Set while the job is archived: off the board, in History, not counted as active. */
  archivedAt: IsoDateTime.optional(),
});
export type Job = z.infer<typeof JobSchema>;
export type JobId = Job['id'];

/** Fields a user may edit directly from the UI. */
export const EDITABLE_FIELDS = [
  'title',
  'company',
  'location',
  'workplaceType',
  'employmentTypes',
  'salary',
  'postedAt',
  'closesAt',
  'description',
  'applyUrl',
  'priority',
  'tags',
  'notes',
  'followUpAt',
] as const satisfies readonly (keyof Job)[];
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type JobPatch = Partial<Pick<Job, EditableField>>;
