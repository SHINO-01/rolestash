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
  /** A change made from a forwarded email (Advanced; ADR-0014). Undoable. */
  'email_update',
] as const;

/** What an email update says happened (src/email's status intents). */
export const EMAIL_UPDATE_INTENTS = [
  'received',
  'assessment',
  'interview',
  'rejected',
  'offer',
] as const;
export type EmailUpdateIntent = (typeof EMAIL_UPDATE_INTENTS)[number];

/** The email behind an update, kept as its reason. Never the email's text. */
export const EmailNoteSchema = z.object({
  intent: z.enum(EMAIL_UPDATE_INTENTS),
  subject: z.string().max(500),
  /** Sender address, or "Name <address>". */
  sender: z.string().max(400),
  receivedAt: IsoDateTime,
});
export type EmailNote = z.infer<typeof EmailNoteSchema>;

/**
 * The next interview, from a calendar invite or the email's text. `start` is
 * an instant with an offset, or a local wall time (`floating`) when the email
 * named no time zone, which is then read in the user's own zone.
 */
export const JobInterviewSchema = z.object({
  start: z.string().max(40).optional(),
  end: z.string().max(40).optional(),
  floating: z.boolean(),
  timeZone: z.string().max(64).optional(),
  location: z.string().max(300).optional(),
  meetingUrl: z.url().max(2000).optional(),
  schedulingUrl: z.url().max(2000).optional(),
});
export type JobInterview = z.infer<typeof JobInterviewSchema>;

/** A lower-confidence email update, waiting for one-click Accept or Dismiss. */
export const SuggestionSchema = z.object({
  id: z.string().min(1),
  createdAt: IsoDateTime,
  toStageId: z.string().optional(),
  interview: JobInterviewSchema.optional(),
  email: EmailNoteSchema,
  /** The email template's fingerprint, so a correction can teach everyone (ADR-0014 §6). */
  template: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

// ── Contacts, interview rounds and documents (Advanced) ─────────────────────

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Someone at the company: recruiter, hiring manager, interviewer, referrer. */
export const ContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  role: optionalText(120),
  email: optionalText(254),
  phone: optionalText(40),
  linkedin: optionalText(300),
  notes: optionalText(2000),
});
export type Contact = z.infer<typeof ContactSchema>;

export const INTERVIEW_KINDS = [
  'phone',
  'video',
  'onsite',
  'technical',
  'panel',
  'final',
  'other',
] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

/** One interview round and the notes from it. */
export const InterviewRoundSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(INTERVIEW_KINDS),
  /** When it is (or was): an exact instant. */
  at: IsoDateTime.optional(),
  with: optionalText(200),
  notes: optionalText(10_000),
});
export type InterviewRound = z.infer<typeof InterviewRoundSchema>;

export const DOCUMENT_KINDS = ['resume', 'cover_letter', 'portfolio', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * A document sent for this job, by name (and optionally a link to where it
 * lives). Rolestash never stores the file itself.
 */
export const DocumentRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(DOCUMENT_KINDS),
  name: z.string().trim().min(1).max(200),
  url: z.url().max(2000).optional(),
  note: optionalText(500),
});
export type DocumentRef = z.infer<typeof DocumentRefSchema>;

export const ActivitySchema = z.object({
  id: z.string().min(1),
  at: IsoDateTime,
  type: z.enum(ACTIVITY_TYPES),
  fromStageId: z.string().optional(),
  toStageId: z.string().optional(),
  /** For `edited`: which fields changed. */
  fields: z.array(z.string()).optional(),
  /** For `email_update`: the email it came from. */
  email: EmailNoteSchema.optional(),
  /** For `email_update`: it set the interview. */
  setInterview: z.boolean().optional(),
  /** For `email_update`: the user undid it. */
  undone: z.boolean().optional(),
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
  /** The next interview, from email updates (Advanced; ADR-0014). */
  interview: JobInterviewSchema.optional(),
  /** A pending email update for the user to accept or dismiss. */
  suggestion: SuggestionSchema.optional(),
  /** People at the company (Advanced). */
  contacts: z.array(ContactSchema).max(30).optional(),
  /** Interview rounds and their notes (Advanced). */
  rounds: z.array(InterviewRoundSchema).max(30).optional(),
  /** Documents sent, by name only (Advanced). */
  documents: z.array(DocumentRefSchema).max(30).optional(),
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
  'contacts',
  'rounds',
  'documents',
] as const satisfies readonly (keyof Job)[];
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type JobPatch = Partial<Pick<Job, EditableField>>;
