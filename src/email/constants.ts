/**
 * Email status updates (ADR-0014): the plain constants and the input shape.
 * Kept free of zod so the Email Worker bundle stays small; the event schema
 * lives in types.ts.
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
