/**
 * Account emails (ADR-0024): the welcome email a new account gets once, and
 * the copy of a bug report that goes to support. Service messages, so no
 * unsubscribe link; they're sent at most once per event.
 */
import { renderEmail } from './email-layout.ts';
import type { Email } from './launch-emails.ts';

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
  return renderEmail({
    subject: first ? `Welcome to Rolestash, ${first}` : 'Welcome to Rolestash',
    preheader: 'Your job search now has one calm place to live. Three things to know.',
    eyebrow: 'Your account is ready',
    title,
    paragraphs: [
      'Thanks for creating your account. Your job search now has one calm place to live. Three things to know:',
    ],
    points: [
      ['Save a job', 'Open any posting and click the Rolestash icon, or press Alt+J.'],
      [
        'Keep it moving',
        'Drag a card when you hear back. Closing dates and follow-ups show up before they slip.',
      ],
      [
        'Your plan and devices',
        'They live in Account, in the extension. Scan its QR code to open your board on your phone.',
      ],
    ],
    button: { label: 'Common questions', url: 'https://rolestash.com/#faq' },
    closing:
      'Something not working? Reply to this email, or use Report a problem in the extension. A real person reads every message.',
    why: 'You’re getting this once, because you created a Rolestash account.',
  });
}

/**
 * Supabase Auth's sign-in code email (Magic Link and Confirm signup), with
 * Supabase's own `{{ .Token }}` placeholder. Written to
 * supabase/templates/sign-in-code.html by `npm run email:templates`.
 */
export function signInCodeEmail(): Email {
  return renderEmail({
    subject: 'Your Rolestash sign-in code',
    preheader: 'Your code is {{ .Token }}. It expires in 10 minutes.',
    eyebrow: 'Sign in',
    title: 'Your sign-in code',
    paragraphs: [
      'Enter this code where you asked for it: the Rolestash extension or the web board. It expires in 10 minutes.',
    ],
    badge: { label: 'Your code', value: '{{ .Token }}', detail: 'Expires in 10 minutes' },
    closing:
      'Didn’t ask for this? You can ignore this email: nobody can sign in without the code. Never share it, not even with us.',
    why: 'You’re getting this because someone asked to sign in to Rolestash with this address.',
  });
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
