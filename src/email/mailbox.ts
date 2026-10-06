import { isPlatformDomain } from './ats';
import type { EmailInput } from './constants';

export type { EmailInput };

/**
 * A connected mailbox (ADR-0032): Gmail and Outlook messages as the
 * `EmailInput` the engine already reads, and the cheap first look that
 * decides which messages are worth downloading in full. Pure: no network,
 * no browser APIs beyond the standard TextDecoder and atob.
 */

// ── The first look: from and subject only ──────────────────────────────────

/** Words in a subject that point at a job application. */
const JOB_SUBJECT =
  /\b(application|applied|applying|apply|candidate|candidacy|interview|interviewing|assessment|assignment|coding (?:challenge|test)|take[- ]home|position|role|vacancy|opening|job|offer|opportunit(?:y|ies)|recruit\w*|hiring|talent|career|next steps|your (?:profile|submission)|thank(?:s| you) for (?:your )?(?:interest|applying)|unfortunately|regret|shortlist\w*|phone screen|screening)\b/i;

/** Mail that is never about an application, whatever its subject says. */
const NOT_JOB_SENDER =
  /(^|\.)(facebookmail|linkedin\.email|e\.linkedin|news|newsletter|marketing|promo|offers?|deals?)\./i;

export interface FirstLook {
  from: string;
  subject: string;
}

/**
 * Worth downloading? Yes for recruiting systems and known employers, and for
 * subjects that talk about an application. Job-alert digests pass too; the
 * engine files them as "other". Generous on purpose: a missed rejection is
 * worse than reading one newsletter on this device.
 */
export function likelyJobEmail(look: FirstLook, companies: readonly string[] = []): boolean {
  const address = /<([^>]+)>/.exec(look.from)?.[1] ?? look.from;
  const domain = address.split('@')[1]?.toLowerCase().trim() ?? '';
  if (domain && NOT_JOB_SENDER.test(domain) && !JOB_SUBJECT.test(look.subject)) return false;
  if (domain && isPlatformDomain(domain) && !/(gmail|outlook|hotmail|yahoo|icloud)\./.test(domain))
    return true;
  if (JOB_SUBJECT.test(look.subject)) return true;
  const haystack = `${look.from} ${look.subject}`.toLowerCase();
  return companies.some((company) => {
    const name = company.toLowerCase().trim();
    return name.length >= 3 && haystack.includes(name);
  });
}

// ── Gmail (users.messages.get, format=full) ────────────────────────────────

interface GmailHeader {
  name?: string;
  value?: string;
}
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

const header = (headers: GmailHeader[] | undefined, name: string) =>
  headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value?.trim();

/** Decodes Gmail's base64url body data in the part's charset (UTF-8 if unknown). */
export function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // an unknown charset name
  }
}

function charsetOf(part: GmailPart): string | undefined {
  return /charset="?([\w.:-]+)"?/i.exec(header(part.headers, 'Content-Type') ?? '')?.[1];
}

/** The first text/plain, text/html and text/calendar bodies, depth first. */
function collectBodies(
  part: GmailPart,
  out: Partial<Record<'text' | 'html' | 'calendar', string>>,
) {
  const type = part.mimeType?.toLowerCase() ?? '';
  const data = part.body?.data;
  if (data) {
    const slot =
      type === 'text/plain' && !part.filename
        ? 'text'
        : type === 'text/html'
          ? 'html'
          : type === 'text/calendar' || part.filename?.toLowerCase().endsWith('.ics')
            ? 'calendar'
            : undefined;
    if (slot && out[slot] === undefined) out[slot] = decodeBase64Url(data, charsetOf(part));
  }
  for (const child of part.parts ?? []) collectBodies(child, out);
}

const MESSAGE_IDS = /<[^<>\s]+>/g;

/** A Gmail message as the engine's input, or undefined when it has no usable parts. */
export function gmailToInput(message: GmailMessage): EmailInput | undefined {
  const payload = message.payload;
  if (!payload) return undefined;
  const headers = payload.headers;
  const from = header(headers, 'From');
  if (!from) return undefined;
  const bodies: Partial<Record<'text' | 'html' | 'calendar', string>> = {};
  collectBodies(payload, bodies);
  const dateHeader = header(headers, 'Date');
  const date =
    dateHeader && !Number.isNaN(Date.parse(dateHeader))
      ? new Date(dateHeader).toISOString()
      : new Date(Number(message.internalDate ?? Date.now())).toISOString();
  const messageId = header(headers, 'Message-ID') ?? header(headers, 'Message-Id');
  const inReplyTo = header(headers, 'In-Reply-To');
  const references = header(headers, 'References')?.match(MESSAGE_IDS) ?? [];
  return {
    from,
    subject: header(headers, 'Subject') ?? '',
    date,
    ...(messageId ? { messageId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references.length ? { references } : {}),
    ...(bodies.text ? { text: bodies.text } : {}),
    ...(bodies.html ? { html: bodies.html } : {}),
    ...(bodies.calendar ? { calendar: bodies.calendar } : {}),
  };
}

/** From and subject from a `format=metadata` message. */
export function gmailFirstLook(message: GmailMessage): FirstLook {
  return {
    from: header(message.payload?.headers, 'From') ?? '',
    subject: header(message.payload?.headers, 'Subject') ?? '',
  };
}

// ── Outlook (Microsoft Graph /me/messages) ─────────────────────────────────

export interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string;
  internetMessageId?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null;
  body?: { contentType?: string; content?: string } | null;
}

function graphFrom(message: GraphMessage): string {
  const address = message.from?.emailAddress?.address?.trim();
  if (!address) return '';
  const name = message.from?.emailAddress?.name?.trim();
  return name && name !== address ? `${name} <${address}>` : address;
}

export function graphFirstLook(message: GraphMessage): FirstLook {
  return { from: graphFrom(message), subject: message.subject ?? '' };
}

/** An Outlook message as the engine's input, or undefined without a sender. */
export function graphToInput(message: GraphMessage): EmailInput | undefined {
  const from = graphFrom(message);
  if (!from) return undefined;
  const received = message.receivedDateTime ? Date.parse(message.receivedDateTime) : NaN;
  const content = message.body?.content ?? '';
  const html = message.body?.contentType?.toLowerCase() === 'html';
  return {
    from,
    subject: message.subject ?? '',
    date: new Date(Number.isNaN(received) ? Date.now() : received).toISOString(),
    ...(message.internetMessageId ? { messageId: message.internetMessageId } : {}),
    ...(content ? (html ? { html: content } : { text: content }) : {}),
  };
}
