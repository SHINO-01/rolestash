import type { EmailUpdateIntent, JobInterview } from '@/domain/job';
import { interviewStart } from '@/domain/interview';

/** Wording and small helpers shared by the email-update components (ADR-0014). */

export { safeHref } from '@/ui/format';

/** "Thu 9 Oct, 10:00 am" in the user's zone (floating times as written). */
export function formatInterviewTime(interview: JobInterview, short = false): string | undefined {
  const start = interviewStart(interview);
  if (!start) return undefined;
  return start.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(short
      ? {}
      : { year: start.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** What each kind of email says, for people. */
export const INTENT_LABEL: Record<EmailUpdateIntent, string> = {
  received: 'Application received',
  assessment: 'Assessment',
  interview: 'Interview',
  rejected: 'Rejection',
  offer: 'Offer',
};

/** "Northwind Recruiting" from "Northwind Recruiting <jobs@…>", or the address. */
export function senderName(sender: string): string {
  return /^(.+?)\s*<[^>]+>$/.exec(sender)?.[1]?.replace(/^"|"$/g, '') ?? sender;
}

/** Senders worth forwarding: recruiting systems, job boards and assessment sites. */
export const SUGGESTED_SENDERS = [
  'greenhouse-mail.io',
  'greenhouse.io',
  'hire.lever.co',
  'myworkday.com',
  'smartrecruiters.com',
  'ashbyhq.com',
  'icims.com',
  'seek.com.au',
  'jobs-noreply@linkedin.com',
  'hackerrankforwork.com',
  'codility.com',
  'calendly.com',
] as const;

/** Words that mark the rest (employers writing from their own domain). */
export const SUGGESTED_SUBJECT =
  '(application OR applying OR interview OR assessment OR offer OR candidacy)';

/** Gmail's From filter for the senders above. */
export const GMAIL_FROM = SUGGESTED_SENDERS.join(' OR ');

/** One Gmail search for both: open it, then "Create filter" from the search. */
export const GMAIL_QUERY = `from:(${GMAIL_FROM}) OR subject:${SUGGESTED_SUBJECT}`;
