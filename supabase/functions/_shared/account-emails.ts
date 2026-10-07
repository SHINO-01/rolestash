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

/** Supabase Auth's Reset password email (ADR-0036); the link opens the web board. */
export function passwordResetEmail(): Email {
  return renderEmail({
    subject: 'Reset your Rolestash password',
    preheader: 'Choose a new password. The link works once, for 10 minutes.',
    eyebrow: 'Password reset',
    title: 'Choose a new password',
    paragraphs: [
      'Someone asked to reset the password for this Rolestash account. The button opens a page where you choose a new one; after that, every device is signed out.',
    ],
    button: { label: 'Choose a new password', url: '{{ .ConfirmationURL }}' },
    closing:
      'Didn’t ask for this? Ignore this email: your password stays the same. The link works once, for 10 minutes.',
    why: 'You’re getting this because a password reset was asked for this address at Rolestash.',
  });
}

/** Supabase Auth's "Password changed" security notice (ADR-0036). */
export function passwordChangedEmail(): Email {
  return renderEmail({
    subject: 'Your Rolestash password was changed',
    preheader: 'If this was you, there’s nothing to do.',
    eyebrow: 'Security',
    title: 'Your password was changed',
    paragraphs: [
      'The password for your Rolestash account ({{ .Email }}) was just added or changed. If this was you, there’s nothing to do.',
      'Wasn’t you? Use “Forgot password?” on the sign-in screen to choose a new one, which signs out every device, and reply to this email so we can help.',
    ],
    button: { label: 'Open Rolestash', url: 'https://rolestash.com/board/' },
    why: 'You’re getting this because the password of your Rolestash account changed. We send it for every change, for your safety.',
  });
}

/** Supabase Auth's notice when an authenticator app is added (ADR-0036). */
export function twoStepOnEmail(): Email {
  return renderEmail({
    subject: 'Two-step sign-in is on for your Rolestash account',
    preheader: 'An authenticator app was added. If this was you, there’s nothing to do.',
    eyebrow: 'Security',
    title: 'Two-step sign-in is on',
    paragraphs: [
      'An authenticator app was just added to your Rolestash account ({{ .Email }}). From now on, signing in also asks for its code.',
      'Wasn’t you? Reply to this email straight away and we’ll secure your account.',
    ],
    button: { label: 'Open Rolestash', url: 'https://rolestash.com/board/' },
    why: 'You’re getting this because the security settings of your Rolestash account changed. We send it for every change, for your safety.',
  });
}

/** Supabase Auth's notice when an authenticator app is removed (ADR-0036). */
export function twoStepRemovedEmail(): Email {
  return renderEmail({
    subject: 'An authenticator app was removed from your Rolestash account',
    preheader: 'If this was you, there’s nothing to do.',
    eyebrow: 'Security',
    title: 'An authenticator app was removed',
    paragraphs: [
      'An authenticator app was just removed from your Rolestash account ({{ .Email }}). If it was the last one, signing in no longer asks for its code.',
      'Wasn’t you? Use “Forgot password?” or sign in with an emailed code, turn two-step sign-in back on in Account → Security, and reply to this email so we can help.',
    ],
    button: { label: 'Open Rolestash', url: 'https://rolestash.com/board/' },
    why: 'You’re getting this because the security settings of your Rolestash account changed. We send it for every change, for your safety.',
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
