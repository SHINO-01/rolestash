import { opsAdmin } from './admin';
import { type Email, optOutUrl, sendEmails, SendError } from './emails';
import { html, type Html } from './html';
import type { Deps, Env } from './panels';

/**
 * Who an offer email goes to (ADR-0038). The database picks the accounts
 * (private.audience) and leaves out anyone who opted out or had an offer in
 * the last 7 days; the Worker never keeps the list.
 */

export const SEGMENTS = {
  everyone: 'Everyone with an account',
  free: 'Free accounts (not on Pro now)',
  trial_ended: 'Trial ended, never paid',
  lapsed: 'Paid before, not now',
  pro: 'On Pro now',
  listed: 'Only the emails I list',
} as const;
export type Segment = keyof typeof SEGMENTS;

/** At most this many recipients per send (Resend batches of 100). */
export const MAX_RECIPIENTS = 1000;

interface Ctx {
  env: Env;
  deps: Deps;
  actor: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The audience fields of a form: `segment` ('' for nobody when optional) and,
 * for 'listed', `emails` (commas, spaces or new lines between them).
 */
export function parseAudience(
  form: FormData,
  optional: boolean,
): { segment: string; emails: string } | string {
  const value = form.get('segment');
  const segment = typeof value === 'string' ? value.trim() : '';
  if (!segment) return optional ? { segment: '', emails: '' } : 'Pick who to email.';
  if (!Object.hasOwn(SEGMENTS, segment)) return 'Pick who to email.';
  if (segment !== 'listed') return { segment, emails: '' };
  const raw = form.get('emails');
  const list = [
    ...new Set(
      (typeof raw === 'string' ? raw : '')
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!list.length) return 'List at least one email address.';
  const bad = list.find((e) => !EMAIL.test(e));
  if (bad) return `${bad} isn't an email address.`;
  if (list.length > MAX_RECIPIENTS) return `List at most ${String(MAX_RECIPIENTS)} addresses.`;
  return { segment, emails: list.join(',') };
}

const emailArgs = (a: Record<string, string>) => ({
  segment: a.segment,
  emails: a.emails ? a.emails.split(',') : [],
});

/** The preview's "who gets it" line, and how many that is right now. */
export async function describeAudience(
  ctx: Ctx,
  a: Record<string, string>,
): Promise<{ count: number; line: Html }> {
  const r = await opsAdmin<{ count: number; sample: string[]; unknown: number }>(
    ctx.env,
    ctx.deps,
    ctx.actor,
    'audience.count',
    emailArgs(a),
  );
  const count = Math.min(r.count, MAX_RECIPIENTS);
  const who = SEGMENTS[a.segment as Segment];
  const line = html`Emails
    <b>${count} ${count === 1 ? 'person' : 'people'}</b>
    (${who}${r.sample.length ? `, such as ${r.sample.join(', ')}` : ''}).
    ${r.count > MAX_RECIPIENTS ? `Only the first ${String(MAX_RECIPIENTS)} this time; send again in a week for the rest. ` : ''}
    ${r.unknown ? `${String(r.unknown)} listed address${r.unknown === 1 ? ' has' : 'es have'} no account and won't be emailed. ` : ''}
    It skips anyone who opted out of offers or had one in the last 7 days, and each email has a
    one-click opt-out.`;
  return { count, line };
}

/** Sends one offer: claims the recipients (marking them emailed now), then sends. */
export async function sendOffer(
  ctx: Ctx,
  a: Record<string, string>,
  kind: string,
  compose: (optOut: string) => Email,
): Promise<number> {
  const recipients = await opsAdmin<{ email: string; token: string }[]>(
    ctx.env,
    ctx.deps,
    ctx.actor,
    'audience.claim',
    { ...emailArgs(a), limit: MAX_RECIPIENTS, kind },
  );
  if (!recipients.length) return 0;
  const key = `${kind}-${ctx.deps.now.toISOString()}`;
  let sent = 0;
  let failure: unknown;
  try {
    sent = await sendEmails(
      ctx.env,
      ctx.deps,
      recipients.map((r) => {
        const url = optOutUrl(ctx.env, r.token);
        return { to: r.email, email: compose(url), optOutUrl: url };
      }),
      key,
    );
  } catch (error) {
    failure = error;
  }
  await opsAdmin(ctx.env, ctx.deps, ctx.actor, 'audit.log', {
    action: `email.${kind}`,
    detail: { segment: a.segment, code: a.code ?? null, recipients: recipients.length },
    outcome: failure
      ? `failed: ${failure instanceof Error ? failure.message : 'error'}`
      : `${String(sent)} sent`,
  });
  if (failure) throw failure instanceof SendError ? failure : new SendError('Sending failed.');
  return sent;
}

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A code for one targeted offer: FOR + 6 unambiguous letters and digits. */
export function targetedCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `FOR${Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length] ?? 'X').join('')}`;
}

/** YYYY-MM-DD in Sydney, `days` after `now`. */
export function sydneyDayAfter(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Australia/Sydney',
  });
}

/** The audience controls for a form; `none` adds a "Nobody" choice first. */
export function audienceFields(none: string | null, selected: Segment | '' = ''): Html {
  return html`<label
      >Email it to<select name="segment">
        ${none ? html`<option value="">${none}</option>` : null}
        ${(Object.keys(SEGMENTS) as Segment[]).map(
          (s) =>
            html`<option value="${s}" ${s === selected ? html`selected` : null}>
              ${SEGMENTS[s]}
            </option>`,
        )}
      </select></label
    >
    <label class="wide"
      >Emails, for "Only the emails I list" (accounts only)<textarea
        name="emails"
        rows="2"
        placeholder="dana@example.com, sam@example.com"
      ></textarea>
    </label>
    <label class="wide"
      >Personal line (optional)<input
        name="message"
        maxlength="300"
        placeholder="Thanks for trying Rolestash. Here's something to help with the search."
    /></label>`;
}
