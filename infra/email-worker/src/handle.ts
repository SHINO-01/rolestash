import PostalMime, { type Address, type Email } from 'postal-mime';
import { analyzeEmail } from '../../../src/email/analyze';
import type { EmailInput } from '../../../src/email/constants';
import type { EmailEvent } from '../../../src/email/types';

/**
 * One forwarded email in, at most one stored event out (ADR-0014, ADR-0018).
 * The message exists only in memory here. Nothing from it is logged, and
 * only the extracted event leaves the Worker.
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  EMAIL_INGEST_SECRET: string;
}

/** The parts of Cloudflare's ForwardableEmailMessage we use. */
export interface IncomingEmail {
  /** Envelope recipient, e.g. `k3x9…@in.rolestash.com`. */
  readonly to: string;
  readonly rawSize: number;
  readonly raw: ReadableStream<Uint8Array> | ArrayBuffer | string;
}

export type Outcome =
  | 'stored'
  | 'duplicate'
  | 'invalid_address'
  | 'too_large'
  | 'unparseable'
  | 'unknown_address'
  | 'not_advanced'
  | 'rate_limited'
  | 'store_failed';

/** Bigger mail is dropped unread: job emails are small, and Workers have tight CPU limits. */
export const MAX_RAW_BYTES = 3 * 1024 * 1024;
const TOKEN = /^[a-km-np-z2-9]{20}$/;

/** The address token from the envelope recipient; `+tags` are ignored. */
export function tokenFrom(to: string): string | undefined {
  const at = to.lastIndexOf('@');
  if (at < 0 || to.slice(at + 1).toLowerCase() !== 'in.rolestash.com') return undefined;
  const local = to.slice(0, at).split('+')[0]?.toLowerCase() ?? '';
  return TOKEN.test(local) ? local : undefined;
}

function formatAddress(address: Address | undefined): string {
  if (!address) return '';
  const mailbox = address.group ? address.group[0] : address;
  if (!mailbox) return '';
  return mailbox.name ? `${mailbox.name} <${mailbox.address}>` : mailbox.address;
}

function calendarOf(email: Email): string | undefined {
  const part = email.attachments.find(
    (a) => a.mimeType === 'text/calendar' || /\.ics$/i.test(a.filename ?? ''),
  );
  if (!part) return undefined;
  if (typeof part.content === 'string') return part.content;
  return new TextDecoder().decode(part.content);
}

export function toEmailInput(email: Email, now: Date): EmailInput {
  const parsedDate = email.date ? new Date(email.date) : undefined;
  return {
    from: formatAddress(email.from),
    subject: email.subject ?? '',
    date:
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? (email.date ?? '') : now.toISOString(),
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references?.split(/\s+/).filter(Boolean),
    text: email.text,
    html: email.html,
    calendar: calendarOf(email),
  };
}

async function store(
  env: Env,
  token: string,
  event: EmailEvent,
  fetchFn: typeof fetch,
): Promise<Outcome> {
  const body = JSON.stringify({
    p_secret: env.EMAIL_INGEST_SECRET,
    p_token: token,
    p_event: event,
  });
  // One retry for a network blip or a 5xx; then the event is dropped.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_email_event`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body,
      });
      if (response.status >= 500) continue;
      if (!response.ok) return 'store_failed';
      const result = (await response.json()) as { ok?: boolean; stored?: boolean; reason?: string };
      if (result.ok) return result.stored ? 'stored' : 'duplicate';
      const reason = result.reason;
      return reason === 'unknown_address' || reason === 'not_advanced' || reason === 'rate_limited'
        ? reason
        : 'store_failed';
    } catch {
      // retry
    }
  }
  return 'store_failed';
}

export async function handleEmail(
  message: IncomingEmail,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Outcome> {
  const token = tokenFrom(message.to);
  if (!token) return 'invalid_address';
  if (message.rawSize > MAX_RAW_BYTES) return 'too_large';

  let email: Email;
  try {
    email = await PostalMime.parse(message.raw, { maxNestingDepth: 32, maxRfc822NestingDepth: 2 });
  } catch {
    return 'unparseable';
  }
  const event = analyzeEmail(toEmailInput(email, now));
  return store(env, token, event, fetchFn);
}
