/**
 * The one look of every Rolestash email (ADR-0038): the account emails
 * (welcome), the updates list, and the dashboard's customer emails. The
 * sign-in code template (supabase/templates/sign-in-code.html) is generated
 * from it (npm run email:templates), and a test keeps them in step.
 *
 * Inline styles only (mail apps drop style sheets), the logo as a hosted PNG
 * (Gmail and Outlook don't show inline SVG), and a plain-text alternative.
 * No imports, so the Edge Functions (Deno) and the ops Worker share it.
 */

export interface EmailParts {
  subject: string;
  html: string;
  text: string;
}

export interface EmailLayout {
  subject: string;
  /** The preview line mail apps show after the subject. */
  preheader: string;
  /** A small label above the title ("A gift from Rolestash"), optional. */
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  /** A highlighted box: a code, or the plan and its end date. */
  badge?: { label: string; value: string; detail?: string };
  /** Short headed points ("Save a job. Open any posting…"). */
  points?: [head: string, body: string][];
  button?: { label: string; url: string };
  secondary?: { label: string; url: string };
  /** After the button, in the card ("Didn't ask for this?…"). */
  closing?: string;
  /** Why they're getting it (footer). */
  why: string;
  /** An unsubscribe or opt-out link for the footer. */
  footerLink?: { label: string; url: string };
}

export const EMAIL_SENDER = 'Rolestash · New South Wales, Australia · support@rolestash.com';
export const EMAIL_MARK_URL = 'https://rolestash.com/assets/email-mark.png';

const e = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The header band: the mark and the wordmark. Also in sign-in-code.html. */
export const EMAIL_HEADER = `<div style="border-top:4px solid #0b5d52;border-bottom:1px solid #eeebe4;padding:18px 28px"><img src="${EMAIL_MARK_URL}" width="36" height="36" alt="" style="display:inline-block;width:36px;height:36px;border:0;vertical-align:middle"><span style="margin-left:10px;font-weight:700;font-size:19px;letter-spacing:-.01em;color:#10231f;vertical-align:middle">role<span style="color:#0b5d52">stash</span></span></div>`;

export function renderEmail(o: EmailLayout): EmailParts {
  const p = (text: string) =>
    `<p style="margin:0 0 16px;color:#4c5b57;font-size:15px;line-height:1.6">${e(text)}</p>`;
  const points = (o.points ?? [])
    .map(
      ([head, body]) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55"><strong style="color:#10231f">${e(head)}.</strong> <span style="color:#4c5b57">${e(body)}</span></p>`,
    )
    .join('\n');
  const badge = o.badge
    ? `<div style="margin:8px 0 24px;border:2px dashed #0b5d52;border-radius:14px;background:#f1f8f5;padding:18px;text-align:center">
<div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#0b5d52">${e(o.badge.label)}</div>
<div style="margin-top:6px;font:700 28px/1.2 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.08em;color:#10231f">${e(o.badge.value)}</div>
${o.badge.detail ? `<div style="margin-top:6px;font-size:13px;color:#4c5b57">${e(o.badge.detail)}</div>` : ''}
</div>`
    : '';
  const button = o.button
    ? `<p style="margin:8px 0 0"><a href="${e(o.button.url)}" style="display:inline-block;background:#0b5d52;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:10px">${e(o.button.label)}</a></p>`
    : '';
  const secondary = o.secondary
    ? `<p style="margin:14px 0 0;font-size:14px"><a href="${e(o.secondary.url)}" style="color:#0b5d52;font-weight:600">${e(o.secondary.label)}</a></p>`
    : '';
  const closing = o.closing
    ? `<p style="margin:20px 0 0;color:#4c5b57;font-size:14px;line-height:1.55">${e(o.closing)}</p>`
    : '';
  const footerLink = o.footerLink
    ? `<p style="margin:0 0 8px"><a href="${e(o.footerLink.url)}" style="color:#0b5d52;font-weight:600">${e(o.footerLink.label)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#fbfaf7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#10231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(o.preheader)}</div>
<div style="padding:24px 12px">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e3da;border-radius:18px;overflow:hidden">
${EMAIL_HEADER}
<div style="padding:28px">
${o.eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0b5d52">${e(o.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#10231f">${e(o.title)}</h1>
${o.paragraphs.map(p).join('\n')}
${points}
${badge}
${button}
${secondary}
${closing}
</div>
</div>
<div style="max-width:520px;margin:16px auto 0;padding:0 4px;font-size:12px;color:#4c5b57;line-height:1.5">
<p style="margin:0 0 8px">${e(o.why)}</p>
${footerLink}
<p style="margin:0">${e(EMAIL_SENDER)}</p>
</div>
</div>
</body></html>`;
  const text = [
    o.title,
    ...o.paragraphs,
    ...(o.points ?? []).map(([head, body]) => `${head}. ${body}`),
    ...(o.badge
      ? [`${o.badge.label}: ${o.badge.value}${o.badge.detail ? ` (${o.badge.detail})` : ''}`]
      : []),
    ...(o.button ? [`${o.button.label}: ${o.button.url}`] : []),
    ...(o.secondary ? [`${o.secondary.label}: ${o.secondary.url}`] : []),
    ...(o.closing ? [o.closing] : []),
    `--\n${o.why}${o.footerLink ? `\n${o.footerLink.label}: ${o.footerLink.url}` : ''}\n${EMAIL_SENDER}`,
  ].join('\n\n');
  return { subject: o.subject, html, text };
}
