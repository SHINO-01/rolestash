/**
 * Account emails (ADR-0024): the welcome email a new account gets once, and
 * the copy of a bug report that goes to support. Service messages, so no
 * unsubscribe link; they're sent at most once per event.
 */
import type { Email } from './launch-emails.ts';

const SENDER = 'Rolestash · New South Wales, Australia · support@rolestash.com';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The first word of a name, or undefined when there's nothing usable. */
export function firstWord(name: string | null | undefined): string | undefined {
  const word = name?.trim().split(/\s+/)[0];
  return word && /\p{L}/u.test(word) ? word.slice(0, 40) : undefined;
}

export function welcomeEmail(name: string | null | undefined): Email {
  const first = firstWord(name);
  const title = first ? `Welcome, ${first}` : 'Welcome to Rolestash';
  const steps: [string, string][] = [
    ['Save a job', 'Open any posting and click the Rolestash icon, or press Alt+J.'],
    [
      'Keep it moving',
      'Drag a card when you hear back. Closing dates and follow-ups show up before they slip.',
    ],
    ['Your plan and devices', 'They live in Account, in the extension.'],
  ];
  const help =
    'Something not working? Reply to this email, or use Report a problem in the extension. A real person reads every message.';
  const why = 'You’re getting this once, because you created a Rolestash account.';
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#fbfaf7;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#10231f">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e7e3da;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-weight:700;font-size:15px;color:#0b5d52">rolestash</p>
<p style="margin:0 0 12px;font-weight:700;font-size:20px">${escape(title)}</p>
<p style="margin:0 0 20px;color:#4c5b57;line-height:1.55">Thanks for creating your account. Your job search now has one calm place to live. Three things to know:</p>
${steps
  .map(
    ([head, body]) =>
      `<p style="margin:0 0 14px;line-height:1.5"><strong style="color:#10231f">${escape(head)}.</strong> <span style="color:#4c5b57">${escape(body)}</span></p>`,
  )
  .join('\n')}
<p style="margin:20px 0 0;color:#4c5b57;line-height:1.55">${escape(help)}</p>
<p style="margin:24px 0 0"><a href="https://rolestash.com/#faq" style="display:inline-block;background:#0b5d52;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Common questions</a></p>
</div>
<div style="max-width:480px;margin:16px auto 0;font-size:12px;color:#4c5b57;line-height:1.5">
<p style="margin:0 0 8px">${escape(why)}</p>
<p style="margin:0">${escape(SENDER)}</p>
</div>
</body></html>`;
  const text = [
    title,
    'Thanks for creating your account. Your job search now has one calm place to live. Three things to know:',
    ...steps.map(([head, body]) => `${head}. ${body}`),
    help,
    'Common questions: https://rolestash.com/#faq',
    `--\n${why}\n${SENDER}`,
  ].join('\n\n');
  return { subject: first ? `Welcome to Rolestash, ${first}` : 'Welcome to Rolestash', html, text };
}

export interface BugReport {
  id: number;
  message: string;
  contactEmail: string | null;
  signedIn: boolean;
  context: Record<string, unknown>;
}

/** Plain-text copy of a report for support; replies go to the reporter. */
export function bugReportEmail(report: BugReport): Email {
  const summary = report.message.replace(/\s+/g, ' ').trim().slice(0, 60);
  const lines = [
    report.message.trim(),
    '--',
    `Reply to: ${report.contactEmail ?? '(no address given)'}${report.signedIn ? ' (signed in)' : ''}`,
    ...Object.entries(report.context).map(([key, value]) => `${key}: ${String(value)}`),
    `Report #${String(report.id)}`,
  ];
  const text = lines.join('\n');
  return {
    subject: `Bug report #${String(report.id)}: ${summary}`,
    text,
    html: `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escape(text)}</pre>`,
  };
}
