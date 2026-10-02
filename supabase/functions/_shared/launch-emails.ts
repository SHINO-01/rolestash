/**
 * Emails to the Rolestash updates list (docs/guides/launch-list.md): the
 * confirmation, "you're on the list", the launch, and product news.
 *
 * Every one of them names the sender and ends with a one-click unsubscribe
 * link that needs no sign-in (Spam Act 2003 (Cth), and plain courtesy), and
 * is sent with a List-Unsubscribe header so mail apps show their own button.
 */

export interface Email {
  subject: string;
  html: string;
  text: string;
}

export interface News {
  subject: string;
  paragraphs: string[];
  button?: { label: string; url: string };
}

const PLAN_NAMES: Record<string, string> = { free: 'Free', pro: 'Pro', advanced: 'Advanced' };
const SENDER = 'Rolestash · New South Wales, Australia · support@rolestash.com';
const WHY =
  'You’re getting this because you signed up for Rolestash updates at rolestash.com. We email only about the launch and new features, a few times a year at most.';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(o: {
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  why: string;
  unsubscribe: { label: string; url: string };
}): Email['html'] {
  const p = (text: string) =>
    `<p style="margin:0 0 16px;color:#4c5b57;line-height:1.55">${escape(text)}</p>`;
  const button = o.button
    ? `<p style="margin:8px 0 24px"><a href="${escape(o.button.url)}" style="display:inline-block;background:#0b5d52;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escape(o.button.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#fbfaf7;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#10231f">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e7e3da;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-weight:700;font-size:15px;color:#0b5d52">rolestash</p>
<p style="margin:0 0 12px;font-weight:700;font-size:20px">${escape(o.title)}</p>
${o.paragraphs.map(p).join('\n')}
${button}
</div>
<div style="max-width:480px;margin:16px auto 0;font-size:12px;color:#4c5b57;line-height:1.5">
<p style="margin:0 0 8px">${escape(o.why)}</p>
<p style="margin:0 0 8px"><a href="${escape(o.unsubscribe.url)}" style="color:#0b5d52;font-weight:600">${escape(o.unsubscribe.label)}</a></p>
<p style="margin:0">${escape(SENDER)}</p>
</div>
</body></html>`;
}

function build(o: {
  subject: string;
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  why?: string;
  unsubscribe: { label: string; url: string };
}): Email {
  const why = o.why ?? WHY;
  return {
    subject: o.subject,
    html: layout({ ...o, why }),
    text: [
      o.title,
      ...o.paragraphs,
      ...(o.button ? [`${o.button.label}: ${o.button.url}`] : []),
      `--\n${why}\n${o.unsubscribe.label}: ${o.unsubscribe.url}\n${SENDER}`,
    ].join('\n\n'),
  };
}

const unsubscribeLink = (url: string) => ({
  label: 'Unsubscribe in one click (no sign-in, no questions)',
  url,
});

export function confirmationEmail(confirmUrl: string, removeUrl: string): Email {
  return build({
    subject: 'Confirm your Rolestash updates',
    title: 'Confirm your email',
    paragraphs: [
      'You asked us to tell you when Rolestash launches on the Chrome Web Store. Confirm this address and we’ll email you on launch day, and now and then about new features.',
      'Didn’t ask? Ignore this email and we’ll forget your address within 30 days.',
    ],
    button: { label: 'Confirm my email', url: confirmUrl },
    why: 'Someone entered this address at rolestash.com. It won’t join our list unless it’s confirmed.',
    unsubscribe: { label: 'Not you? Remove this address now', url: removeUrl },
  });
}

export function welcomeEmail(plan: string | null, unsubscribeUrl: string): Email {
  const interest =
    plan && PLAN_NAMES[plan] ? ` You told us you’re interested in ${PLAN_NAMES[plan]}.` : '';
  return build({
    subject: 'You’re on the Rolestash list',
    title: 'You’re on the list',
    paragraphs: [
      `We’ll email you the day Rolestash goes live on the Chrome Web Store, and occasionally when we ship something new.${interest}`,
      'Every email has a one-click unsubscribe link at the bottom, and there’s one in this email too. Questions? Just reply.',
    ],
    unsubscribe: unsubscribeLink(unsubscribeUrl),
  });
}

export function launchEmail(plan: string | null, storeUrl: string, unsubscribeUrl: string): Email {
  const trial =
    plan === 'pro' || plan === 'advanced'
      ? 'Try Advanced free for 14 days, no card needed.'
      : 'It’s free for up to 30 active jobs, and you can try Advanced free for 14 days.';
  return build({
    subject: 'Rolestash is live on the Chrome Web Store',
    title: 'Rolestash is live',
    paragraphs: [
      'Save any job posting to a private board in one click, from SEEK, LinkedIn, Indeed, Workday and 50+ other sites.',
      trial,
    ],
    button: { label: 'Add to Chrome', url: storeUrl },
    unsubscribe: unsubscribeLink(unsubscribeUrl),
  });
}

export function newsEmail(news: News, unsubscribeUrl: string): Email {
  return build({
    subject: news.subject,
    title: news.subject,
    paragraphs: news.paragraphs,
    ...(news.button ? { button: news.button } : {}),
    unsubscribe: unsubscribeLink(unsubscribeUrl),
  });
}

/**
 * Parses a product-news source file (emails/news/*.md):
 *
 *   Subject: What's new in Rolestash
 *   Button: Read more | https://rolestash.com/...     (optional)
 *
 *   First paragraph.
 *
 *   Second paragraph.
 *
 * Returns null when there's no subject or no body, or the button isn't https.
 */
export function parseNews(source: string): News | null {
  const [head = '', ...rest] = source
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/);
  const header = Object.fromEntries(
    head.split('\n').flatMap((line) => {
      const m = /^(\w+):\s*(.+)$/.exec(line.trim());
      return m?.[1] && m[2] ? [[m[1].toLowerCase(), m[2].trim()]] : [];
    }),
  ) as Record<string, string | undefined>;
  const subject = header.subject;
  const paragraphs = rest.map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (!subject || paragraphs.length === 0) return null;
  if (!header.button) return { subject, paragraphs };
  const [label, url] = header.button.split('|').map((s) => s.trim());
  if (!label || !url?.startsWith('https://')) return null;
  return { subject, paragraphs, button: { label, url } };
}
