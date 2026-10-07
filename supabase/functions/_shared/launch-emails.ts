/**
 * Emails to the Rolestash updates list (docs/guides/launch-list.md): the
 * confirmation, "you're on the list", the launch, and product news.
 *
 * Every one of them names the sender and ends with a one-click unsubscribe
 * link that needs no sign-in (Spam Act 2003 (Cth), and plain courtesy), and
 * is sent with a List-Unsubscribe header so mail apps show their own button.
 */

import { renderEmail } from './email-layout.ts';

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

const PLAN_NAMES: Record<string, string> = { free: 'Free', pro: 'Pro', advanced: 'Pro' };
const WHY =
  'You’re getting this because you signed up for Rolestash updates at rolestash.com. We email only about new features, a few times a year at most.';

function build(o: {
  subject: string;
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  why?: string;
  unsubscribe: { label: string; url: string };
}): Email {
  return renderEmail({
    subject: o.subject,
    preheader: o.paragraphs[0] ?? o.title,
    title: o.title,
    paragraphs: o.paragraphs,
    ...(o.button ? { button: o.button } : {}),
    why: o.why ?? WHY,
    footerLink: o.unsubscribe,
  });
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
      'You asked for Rolestash product news. Confirm this address and we’ll email you now and then when we ship something new.',
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
      `We’ll email you occasionally when we ship something new.${interest}`,
      'Every email has a one-click unsubscribe link at the bottom, and there’s one in this email too. Questions? Just reply.',
    ],
    unsubscribe: unsubscribeLink(unsubscribeUrl),
  });
}

export function launchEmail(plan: string | null, storeUrl: string, unsubscribeUrl: string): Email {
  const trial =
    plan === 'pro' || plan === 'advanced'
      ? 'Try Pro free for 14 days, no card needed.'
      : 'It’s free for up to 30 active jobs, and you can try Pro free for 14 days.';
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
