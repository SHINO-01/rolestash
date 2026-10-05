import PostalMime, { type Address, type Email } from 'postal-mime';
import { analyzeEmailWithSkeleton } from '../../../src/email/analyze';
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

interface RpcResult {
  ok?: boolean;
  stored?: boolean;
  reason?: string;
}

/** Calls one ingest RPC with the Worker's secret; undefined when it can't be reached. */
async function rpc(
  env: Env,
  name: 'email_inbox_check' | 'ingest_email_event',
  args: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<RpcResult | undefined> {
  const body = JSON.stringify({ p_secret: env.EMAIL_INGEST_SECRET, ...args });
  // One retry for a network blip or a 5xx; then the mail is dropped.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body,
      });
      if (response.status >= 500) continue;
      if (!response.ok) return undefined;
      return (await response.json()) as RpcResult;
    } catch {
      // retry
    }
  }
  return undefined;
}

/** The outcome for a refused address, or undefined when the RPC said ok. */
function refusal(result: RpcResult | undefined): Outcome | undefined {
  if (!result) return 'store_failed';
  if (result.ok) return undefined;
  const reason = result.reason;
  return reason === 'unknown_address' || reason === 'not_advanced' || reason === 'rate_limited'
    ? reason
    : 'store_failed';
}

async function store(
  env: Env,
  token: string,
  event: EmailEvent,
  fetchFn: typeof fetch,
): Promise<Outcome> {
  const result = await rpc(env, 'ingest_email_event', { p_token: token, p_event: event }, fetchFn);
  return refusal(result) ?? (result?.stored ? 'stored' : 'duplicate');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  // Ask first, so mail to an unknown, paused or rate-limited address is
  // never parsed or analysed. Ingest still checks everything itself.
  const refused = refusal(await rpc(env, 'email_inbox_check', { p_token: token }, fetchFn));
  if (refused) return refused;

  let email: Email;
  try {
    email = await PostalMime.parse(message.raw, { maxNestingDepth: 32, maxRfc822NestingDepth: 2 });
  } catch {
    return 'unparseable';
  }
  const input = toEmailInput(email, now);
  const { event, skeleton } = analyzeEmailWithSkeleton(input);
  // Shared learning (ADR-0014 §6): only a one-way fingerprint of the template.
  if (skeleton) event.template = await sha256Hex(skeleton);
  return store(env, token, event, fetchFn);
}
