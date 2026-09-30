/**
 * The launch list's three emails (docs/guides/launch-list.md): confirm, you're
 * on the list, and the launch itself. Each has an HTML and a plain-text body,
 * names the sender, and (after confirmation) carries an unsubscribe link, as
 * the Spam Act 2003 (Cth) requires.
 */

export interface Email {
  subject: string;
  html: string;
  text: string;
}

const PLAN_NAMES: Record<string, string> = { free: 'Free', pro: 'Pro', advanced: 'Advanced' };
const FOOTER =
  'Rolestash · New South Wales, Australia · support@rolestash.com. You get this email because you asked rolestash.com to tell you when Rolestash launches.';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(o: {
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  unsubscribeUrl?: string;
}): string {
  const p = (html: string) =>
    `<p style="margin:0 0 16px;color:#4c5b57;line-height:1.55">${html}</p>`;
  const button = o.button
    ? `<p style="margin:8px 0 24px"><a href="${escape(o.button.url)}" style="display:inline-block;background:#0b5d52;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escape(o.button.label)}</a></p>`
    : '';
  const unsubscribe = o.unsubscribeUrl
    ? ` <a href="${escape(o.unsubscribeUrl)}" style="color:#4c5b57">Unsubscribe</a>.`
    : '';
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#fbfaf7;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#10231f">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e7e3da;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-weight:700;font-size:15px;color:#0b5d52">rolestash</p>
<p style="margin:0 0 12px;font-weight:700;font-size:20px">${escape(o.title)}</p>
${o.paragraphs.map((x) => p(x)).join('\n')}
${button}
</div>
<p style="max-width:480px;margin:16px auto 0;font-size:12px;color:#4c5b57;line-height:1.5">${escape(FOOTER)}${unsubscribe}</p>
</body></html>`;
}

const plain = (lines: (string | undefined)[]) =>
  lines.filter((l) => l !== undefined).join('\n\n') + `\n\n--\n${FOOTER}`;

export function confirmationEmail(confirmUrl: string): Email {
  return {
    subject: 'Confirm your Rolestash launch updates',
    html: layout({
      title: 'Confirm your email',
      paragraphs: [
        'You asked us to tell you when Rolestash launches on the Chrome Web Store. Confirm this address and we’ll email you once, on launch day.',
        'Didn’t ask? Ignore this email. We’ll forget your address within 30 days.',
      ],
      button: { label: 'Confirm my email', url: confirmUrl },
    }),
    text: plain([
      'Confirm your email',
      'You asked us to tell you when Rolestash launches on the Chrome Web Store. Confirm this address and we’ll email you once, on launch day:',
      confirmUrl,
      'Didn’t ask? Ignore this email. We’ll forget your address within 30 days.',
    ]),
  };
}

export function welcomeEmail(plan: string | null, unsubscribeUrl: string): Email {
  const interest = plan && PLAN_NAMES[plan] ? ` You’re interested in ${PLAN_NAMES[plan]}.` : '';
  const body = `We’ll email you once, when Rolestash is live on the Chrome Web Store, and then delete your address.${interest}`;
  return {
    subject: 'You’re on the Rolestash launch list',
    html: layout({
      title: 'You’re on the list',
      paragraphs: [escape(body), 'Questions in the meantime? Just reply to this email.'],
      unsubscribeUrl,
    }),
    text: plain([
      'You’re on the list',
      body,
      'Questions in the meantime? Just reply to this email.',
      `Unsubscribe: ${unsubscribeUrl}`,
    ]),
  };
}

export function launchEmail(plan: string | null, storeUrl: string, unsubscribeUrl: string): Email {
  const trial =
    plan === 'pro' || plan === 'advanced'
      ? 'Pro comes with a 30-day free trial, no card needed.'
      : 'It’s free for up to 15 active jobs, and Pro comes with a 30-day free trial.';
  const closing =
    'This is the only launch email we’ll send. We’ve now deleted your address from the launch list.';
  return {
    subject: 'Rolestash is live on the Chrome Web Store',
    html: layout({
      title: 'Rolestash is live',
      paragraphs: [
        'Save any job posting to a private board in one click, from SEEK, LinkedIn, Indeed, Workday and 50+ other sites.',
        escape(trial),
        escape(closing),
      ],
      button: { label: 'Add to Chrome', url: storeUrl },
      unsubscribeUrl,
    }),
    text: plain([
      'Rolestash is live',
      'Save any job posting to a private board in one click, from SEEK, LinkedIn, Indeed, Workday and 50+ other sites.',
      trial,
      `Add to Chrome: ${storeUrl}`,
      closing,
    ]),
  };
}
