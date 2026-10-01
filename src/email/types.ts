import { z } from 'zod';

/**
 * Email status updates (ADR-0014). The engine turns one forwarded email into
 * an `EmailEvent`: what happened (intent), how sure we are, and the facts we
 * need to match it to a job and show an interview. The raw email is never
 * stored; only the event is.
 *
 * Zod schemas are the single source of truth: the Email Worker writes events
 * in this shape, and the extension validates them when it pulls them.
 */

/** A parsed email, as the Email Worker hands it over (MIME already decoded). */
export interface EmailInput {
  /** The `From` header, e.g. `Acme Careers <no-reply@acme.example>`. */
  from: string;
  subject: string;
  /** The `Date` header as ISO 8601. Keep the sender's offset when known. */
  date: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  /** The text/plain part, if any. */
  text?: string;
  /** The text/html part, if any. Never rendered; only read. */
  html?: string;
  /** A text/calendar part or .ics attachment, raw. */
  calendar?: string;
}

export const EMAIL_INTENTS = [
  'received',
  'assessment',
  'interview',
  'rejected',
  'offer',
  'other',
  'forwarding_verification',
] as const;
export type EmailIntent = (typeof EMAIL_INTENTS)[number];

/** The intents that can move a card. */
export const STATUS_INTENTS = ['received', 'assessment', 'interview', 'rejected', 'offer'] as const;
export type StatusIntent = (typeof STATUS_INTENTS)[number];

/**
 * - `apply`    confident: change the card (undoable)
 * - `suggest`  show a one-click suggestion on the card
 * - `none`     no change
 */
export const EMAIL_ACTIONS = ['apply', 'suggest', 'none'] as const;
export type EmailAction = (typeof EMAIL_ACTIONS)[number];

export const ATS_IDS = [
  'greenhouse',
  'lever',
  'workday',
  'smartrecruiters',
  'ashby',
  'icims',
  'seek',
  'linkedin',
] as const;
export type AtsId = (typeof ATS_IDS)[number];

export const InterviewSchema = z.object({
  /**
   * An exact instant (ISO with offset) when the time zone is known, or a
   * local wall time without an offset (`2026-10-07T14:30:00`) when it isn't,
   * with `floating: true`. Floating times are read in the user's time zone.
   */
  start: z.string().max(40).optional(),
  end: z.string().max(40).optional(),
  floating: z.boolean(),
  /** IANA zone the time was given in, when known. */
  timeZone: z.string().max(64).optional(),
  location: z.string().max(300).optional(),
  meetingUrl: z.url().max(2000).optional(),
  /** A "pick a time" link (Calendly, GoodTime, …) when no time is set yet. */
  schedulingUrl: z.url().max(2000).optional(),
  source: z.enum(['calendar', 'text']),
});
export type Interview = z.infer<typeof InterviewSchema>;

export const EmailEventSchema = z.object({
  intent: z.enum(EMAIL_INTENTS),
  /** 0..1 */
  confidence: z.number().min(0).max(1),
  action: z.enum(EMAIL_ACTIONS),
  /** Why the engine decided this; shown in debugging, never personal data beyond the email. */
  reasons: z.array(z.string().max(200)).max(20),
  sender: z.object({
    address: z.string().max(320),
    domain: z.string().max(253),
    name: z.string().max(200).optional(),
  }),
  subject: z.string().max(500),
  receivedAt: z.iso.datetime({ offset: true }),
  ats: z.enum(ATS_IDS).optional(),
  atsJobId: z.string().max(200).optional(),
  postingUrls: z.array(z.url().max(2000)).max(10),
  companyHint: z.string().max(200).optional(),
  titleHint: z.string().max(300).optional(),
  interview: InterviewSchema.optional(),
  /** Gmail's forwarding confirmation (ADR-0014 §1). */
  verification: z
    .object({ code: z.string().max(40).optional(), url: z.url().max(2000).optional() })
    .optional(),
  thread: z.object({
    messageId: z.string().max(998).optional(),
    inReplyTo: z.string().max(998).optional(),
    references: z.array(z.string().max(998)).max(50),
  }),
});
export type EmailEvent = z.infer<typeof EmailEventSchema>;
