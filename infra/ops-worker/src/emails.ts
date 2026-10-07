import { escapeHtml } from './html';
import type { Deps, Env } from './panels';

/**
 * Emails the dashboard sends to customers (ADR-0038): complimentary Pro (a
 * service message) and offers (discount codes, referrals), which carry a
 * one-click opt-out. Sent through Resend with RESEND_SEND_KEY, a key that
 * can only send.
 */

export interface Email {
  subject: string;
  html: string;
  text: string;
}

export interface Message {
  to: string;
  email: Email;
  /** Offers only: the one-click opt-out link. */
  optOutUrl?: string;
}

const SENDER = 'Rolestash · New South Wales, Australia · support@rolestash.com';
const PRICING = 'https://rolestash.com/pricing/';
const STORE = 'https://chromewebstore.google.com/detail/rolestash/cncilbdakhabnocnjokbonggomndedgp';
const BOARD = 'https://rolestash.com/board/';

/** A highlighted box in the email: a code, or the plan and its end date. */
interface Badge {
  label: string;
  value: string;
  detail?: string;
}

interface Layout {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  badge?: Badge;
  button: { label: string; url: string };
  secondary?: { label: string; url: string };
  why: string;
  optOutUrl?: string;
}

const e = escapeHtml;

/** The branded layout, with inline styles only (mail apps drop style sheets). */
function render(o: Layout): Email {
  const p = (text: string) =>
    `<p style="margin:0 0 16px;color:#4c5b57;font-size:15px;line-height:1.6">${e(text)}</p>`;
  const badge = o.badge
    ? `<div style="margin:8px 0 24px;border:2px dashed #0b5d52;border-radius:14px;background:#f1f8f5;padding:18px;text-align:center">
<div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#0b5d52">${e(o.badge.label)}</div>
<div style="margin-top:6px;font:700 26px/1.2 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.06em;color:#10231f">${e(o.badge.value)}</div>
${o.badge.detail ? `<div style="margin-top:6px;font-size:13px;color:#4c5b57">${e(o.badge.detail)}</div>` : ''}
</div>`
    : '';
  const secondary = o.secondary
    ? `<p style="margin:14px 0 0;font-size:14px"><a href="${e(o.secondary.url)}" style="color:#0b5d52;font-weight:600">${e(o.secondary.label)}</a></p>`
    : '';
  const optOut = o.optOutUrl
    ? `<p style="margin:0 0 8px"><a href="${e(o.optOutUrl)}" style="color:#0b5d52;font-weight:600">No more offers, please (one click)</a></p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#fbfaf7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#10231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(o.preheader)}</div>
<div style="padding:24px 12px">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e3da;border-radius:18px;overflow:hidden">
<div style="background:#0b5d52;padding:22px 28px">
<span style="display:inline-block;width:12px;height:16px;background:#f4b63f;border-radius:3px;transform:rotate(-9deg);vertical-align:middle"></span>
<span style="margin-left:8px;font-weight:700;font-size:16px;color:#ffffff;vertical-align:middle">role<span style="color:#f4b63f">stash</span></span>
</div>
<div style="padding:28px">
<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0b5d52">${e(o.eyebrow)}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#10231f">${e(o.title)}</h1>
${o.paragraphs.map(p).join('\n')}
${badge}
<p style="margin:8px 0 0"><a href="${e(o.button.url)}" style="display:inline-block;background:#0b5d52;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:10px">${e(o.button.label)}</a></p>
${secondary}
</div>
</div>
<div style="max-width:520px;margin:16px auto 0;padding:0 4px;font-size:12px;color:#4c5b57;line-height:1.5">
<p style="margin:0 0 8px">${e(o.why)}</p>
${optOut}
<p style="margin:0">${e(SENDER)}</p>
</div>
</div>
</body></html>`;
  const text = [
    o.title,
    ...o.paragraphs,
    ...(o.badge
      ? [`${o.badge.label}: ${o.badge.value}${o.badge.detail ? ` (${o.badge.detail})` : ''}`]
      : []),
    `${o.button.label}: ${o.button.url}`,
    ...(o.secondary ? [`${o.secondary.label}: ${o.secondary.url}`] : []),
    `--\n${o.why}${o.optOutUrl ? `\nNo more offers: ${o.optOutUrl}` : ''}\n${SENDER}`,
  ].join('\n\n');
  return { subject: o.subject, html, text };
}

/** "31 January 2027" in Sydney. */
export function longDate(isoOrDay: string): string {
  const at = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? `${isoOrDay}T12:00:00+10:00` : isoOrDay,
  );
  return at.toLocaleDateString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Complimentary Pro (a service message: no opt-out, sent once per grant). */
export function grantEmail(o: { until: string; hasAccount: boolean }): Email {
  const ends = o.until ? `until ${longDate(o.until)}` : 'with no end date';
  return render({
    subject: 'You’ve got Rolestash Pro, on us',
    preheader: `Complimentary Pro ${ends}. No card, nothing to do.`,
    eyebrow: 'A gift from Rolestash',
    title: 'You’ve got Pro, on us',
    paragraphs: [
      `We’ve added complimentary Rolestash Pro to this email address, ${ends}. No card and no catch: unlimited jobs, status updates from your job emails, full autofill, insights and sync, including your phone.`,
      o.hasAccount
        ? 'It’s already on your account. If the extension still shows Free, open Account and it updates.'
        : 'To use it, add Rolestash to Chrome and sign in with this email address. Pro is waiting for you.',
    ],
    badge: {
      label: 'Your plan',
      value: 'PRO',
      detail: o.until ? `Until ${longDate(o.until)}` : 'No end date',
    },
    button: o.hasAccount
      ? { label: 'Open your board on your phone', url: BOARD }
      : { label: 'Add Rolestash to Chrome', url: STORE },
    ...(o.hasAccount
      ? {}
      : { secondary: { label: 'Or open the web board on your phone', url: BOARD } }),
    why: 'You’re getting this once, because Rolestash gave this address complimentary Pro. Questions? Just reply.',
  });
}

export interface CodeOffer {
  code: string;
  percent: number;
  /** "the first payment", "every payment"… */
  payments: string;
  /** "Monthly, Yearly"; empty for every plan. */
  plans: string;
  /** Last day (YYYY-MM-DD) or ''. */
  until: string;
  /** A personal line from the owner, or ''. */
  note: string;
  /** Just for them (a targeted offer), or for everyone. */
  personal: boolean;
}

/** A discount code, with its pricing link. */
export function codeEmail(o: CodeOffer, optOutUrl: string): Email {
  const link = `${PRICING}?code=${encodeURIComponent(o.code)}`;
  const ends = o.until ? ` Use it by ${longDate(o.until)}.` : '';
  const scope = `${String(o.percent)}% off ${o.payments} of Rolestash Pro${o.plans ? ` (${o.plans})` : ''}.`;
  return render({
    subject: o.personal
      ? `${String(o.percent)}% off Rolestash Pro, just for you`
      : `${String(o.percent)}% off Rolestash Pro with ${o.code}`,
    preheader: `${scope}${ends}`,
    eyebrow: o.personal ? 'An offer for you' : 'Offer',
    title: o.personal
      ? `${String(o.percent)}% off Pro, just for you`
      : `${String(o.percent)}% off Pro`,
    paragraphs: [
      ...(o.note ? [o.note] : []),
      `${scope}${ends} Pro brings unlimited jobs, status updates from your job emails, full autofill, insights and sync across 5 devices, including your phone.`,
      'The button applies the code for you; you can also type it at checkout.',
    ],
    badge: {
      label: 'Your code',
      value: o.code,
      detail: o.until ? `Until ${longDate(o.until)}` : `${String(o.percent)}% off`,
    },
    button: { label: `Get ${String(o.percent)}% off`, url: link },
    why: 'You’re getting this because you have a Rolestash account. We send offers rarely, never more than one a week.',
    optOutUrl,
  });
}

/** The referral programme is on. */
export function referralEmail(o: { percent: number; note: string }, optOutUrl: string): Email {
  return render({
    subject: 'Invite friends to Rolestash, get Pro months free',
    preheader: `Friends get ${String(o.percent)}% off their first month; you get a free month for each.`,
    eyebrow: 'New: invite friends',
    title: 'Share Rolestash, get free months of Pro',
    paragraphs: [
      ...(o.note ? [o.note] : []),
      `Know someone job hunting? Send them your invite link. They get ${String(o.percent)}% off their first month of Pro, and you get a free month for each friend who stays past 14 days (up to 12 a year).`,
      'Find your link in the extension: open Account, then Invite friends. It’s on the web board’s Account page too.',
    ],
    badge: {
      label: 'For each friend',
      value: '1 MONTH FREE',
      detail: `They get ${String(o.percent)}% off`,
    },
    button: { label: 'Open the web board', url: BOARD },
    why: 'You’re getting this because you have a Rolestash account. We send offers rarely, never more than one a week.',
    optOutUrl,
  });
}

export class SendError extends Error {
  override name = 'SendError';
}

export const senderConfigured = (env: Env): boolean => Boolean(env.RESEND_SEND_KEY);

/** The opt-out link for a contact token (handled by the launch-list function). */
export const optOutUrl = (env: Env, token: string): string =>
  `${env.SUPABASE_URL ?? ''}/functions/v1/launch-list?optout=${encodeURIComponent(token)}`;

/**
 * Sends through Resend's batch endpoint, 100 at a time. `key` makes a retry
 * of the same send idempotent at Resend (for 24 hours). Returns how many
 * were accepted; throws on the first refused batch, saying how many went.
 */
export async function sendEmails(
  env: Env,
  deps: Deps,
  messages: Message[],
  key: string,
): Promise<number> {
  if (!env.RESEND_SEND_KEY) throw new SendError('Sending needs RESEND_SEND_KEY.');
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({
      from: env.EMAIL_FROM ?? 'Rolestash <noreply@rolestash.com>',
      to: [m.to],
      reply_to: 'support@rolestash.com',
      subject: m.email.subject,
      html: m.email.html,
      text: m.email.text,
      ...(m.optOutUrl
        ? {
            headers: {
              'List-Unsubscribe': `<${m.optOutUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    }));
    const response = await deps.fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_SEND_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${key}-${String(i / 100)}`.slice(0, 256),
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new SendError(
        `Resend refused the emails (HTTP ${String(response.status)})${sent ? ` after ${String(sent)} were sent` : ''}.`,
      );
    sent += chunk.length;
  }
  return sent;
}
