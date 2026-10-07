import { opsAdmin } from './admin';
import { codeEmail, grantEmail, referralEmail, sendEmails, senderConfigured } from './emails';
import { html, type Html } from './html';
import { runReferralJob } from './jobs';
import {
  archiveDiscount,
  createCode,
  type Discount,
  createReferralDiscount,
  INTERVAL_LABEL,
  INTERVALS,
  listDiscounts,
  PAYMENTS_LABEL,
  proPrices,
  type Interval,
  type Payments,
} from './paddle-admin';
import { describeAudience, parseAudience, sendOffer, sydneyDayAfter, targetedCode } from './offers';
import type { Deps, Env } from './panels';
import { day } from './views';

/**
 * The dashboard's actions (ADR-0037). Each takes its form's fields, checks
 * them, says exactly what it will do (the confirmation page), then does it.
 * Database changes go through ops_admin (logged there); Paddle changes are
 * logged with audit.log.
 */

export interface ActionContext {
  env: Env;
  deps: Deps;
  /** The Access-verified email. */
  actor: string;
}

export type Args = Record<string, string>;

/** A refusal to show as is ("LAUNCH30 already exists in Paddle"). */
export class ActionError extends Error {
  override name = 'ActionError';
}

export interface Preview {
  /** What will happen, in plain words. */
  lines: Html[];
  button: string;
  danger?: boolean;
}

export interface Action {
  page: string;
  title: string;
  parse(form: FormData, now: Date): Args | string;
  /** Text the owner types again to confirm (the email, for grants). */
  typed?: (args: Args) => string;
  preview(ctx: ActionContext, args: Args): Promise<Preview>;
  /** Returns the notice shown afterwards. */
  apply(ctx: ActionContext, args: Args): Promise<string>;
  /**
   * Small, easily undone changes (a report's status) skip the confirmation
   * page; the signed first-step token, Access and the Origin check still apply.
   */
  instant?: boolean;
  /** Where to go afterwards, when not `page` (keeps a list's filter). */
  back?: (args: Args) => string;
}

export const REPORT_STATUSES = ['new', 'seen', 'fixed', 'closed'] as const;
export const REPORT_VIEWS = ['open', 'all', ...REPORT_STATUSES] as const;
export const REASONS = ['tester', 'team', 'partner', 'support', 'owner', 'referral'] as const;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9]{3,20}$/;

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** A YYYY-MM-DD that's today or later in Sydney, or '' for none; else an error. */
function futureDate(value: string, now: Date, what: string): string | { error: string } {
  if (!value) return '';
  if (!DATE.test(value) || Number.isNaN(Date.parse(value)))
    return { error: `${what}: use a date.` };
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  return value < today ? { error: `${what} is in the past.` } : value;
}

const endsText = (until: string) =>
  until ? `until the end of ${day(`${until}T12:00:00+10:00`)} (Sydney)` : 'with no end date';

/** The friends' discount percent from the programme settings. */
const percentOf = (settings: Record<string, unknown>): number =>
  typeof settings.referral_percent === 'number' ? settings.referral_percent : 50;

/** The owner's personal line for an offer email ('' for none). */
function message(form: FormData): string | { error: string } {
  const text = field(form, 'message').replace(/\s+/g, ' ');
  return text.length > 300 ? { error: 'Keep the personal line to 300 characters.' } : text;
}

/** The audience and personal line of an offer form, merged into its args. */
function offerArgs(form: FormData, optional: boolean): Args | string {
  const audience = parseAudience(form, optional);
  if (typeof audience === 'string') return audience;
  const note = message(form);
  if (typeof note !== 'string') return note.error;
  return audience.segment ? { ...audience, message: note } : {};
}

/** The preview lines for an offer, or a refusal when nobody would get it. */
async function offerLines(ctx: ActionContext, a: Args, what: Html): Promise<Html[]> {
  if (!a.segment) return [];
  if (!senderConfigured(ctx.env))
    throw new ActionError('Sending emails needs RESEND_SEND_KEY (docs/guides/operations.md).');
  const { count, line } = await describeAudience(ctx, a);
  if (!count) throw new ActionError('Nobody in that audience can get an offer right now.');
  return [html`${what} ${line}`];
}

/** A live, typeable code from Paddle (not the referral discount). */
async function liveCode(ctx: ActionContext, id: string): Promise<Discount> {
  const d = (await listDiscounts(ctx.env, ctx.deps)).find((x) => x.id === id);
  if (!d?.code || d.kind === 'referral' || d.status !== 'active')
    throw new ActionError('That code is no longer live.');
  return d;
}

const sentText = (n: number) => `${String(n)} ${n === 1 ? 'email' : 'emails'} sent`;

/** The email-ready description of a Paddle code. */
async function codeOffer(ctx: ActionContext, d: Discount, note: string, personal: boolean) {
  const prices = await proPrices(ctx.env, ctx.deps).catch(() => undefined);
  const plans =
    d.restrictTo && prices
      ? INTERVALS.filter((i) => d.restrictTo?.includes(prices[i])).map((i) => INTERVAL_LABEL[i])
      : [];
  return {
    code: d.code ?? '',
    percent: Number(d.amount),
    payments: !d.recur
      ? PAYMENTS_LABEL.first
      : d.maxRecurring === 3
        ? PAYMENTS_LABEL.three
        : PAYMENTS_LABEL.all,
    plans: plans.length === INTERVALS.length ? '' : plans.join(', '),
    until: d.expiresAt ?? '',
    note,
    personal,
  };
}

async function audit(
  ctx: ActionContext,
  action: string,
  detail: Record<string, unknown>,
  outcome: string,
) {
  await opsAdmin(ctx.env, ctx.deps, ctx.actor, 'audit.log', { action, detail, outcome });
}

interface GrantPreview {
  has_account: boolean;
  status: string | null;
  complimentary: string | null;
  active_grant: { reason: string; expires_at: string | null } | null;
}

const describeAccount = (email: string, p: GrantPreview): Html =>
  p.has_account
    ? html`<b>${email}</b> has an account, now
        ${p.complimentary ? `on a ${p.complimentary} grant` : (p.status ?? 'unknown')}.`
    : html`<b>${email}</b> has no account yet.`;

export const ACTIONS: Record<string, Action> = {
  'report.status': {
    page: '/reports',
    title: 'Change a report',
    instant: true,
    back: (a) => (a.view && a.view !== 'open' ? `/reports?status=${a.view}` : '/reports'),
    parse(form) {
      const id = field(form, 'id');
      const status = field(form, 'status');
      const view = field(form, 'view');
      if (!/^\d{1,12}$/.test(id)) return 'Unknown report.';
      if (!(REPORT_STATUSES as readonly string[]).includes(status)) return 'Unknown status.';
      return {
        id,
        status,
        view: (REPORT_VIEWS as readonly string[]).includes(view) ? view : 'open',
      };
    },
    preview(_ctx, a) {
      return Promise.resolve({
        lines: [html`Marks report #${a.id} as ${a.status}.`],
        button: 'Save',
      });
    },
    async apply(ctx, a) {
      const r = await opsAdmin<{ outcome: string }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'reports.set_status',
        { id: Number(a.id), status: a.status },
      );
      return r.outcome === 'none'
        ? `Report #${a.id ?? ''} was already ${a.status ?? ''}.`
        : `Report #${a.id ?? ''} is now ${a.status ?? ''}.`;
    },
  },

  'grant.give': {
    page: '/grants',
    title: 'Give Pro',
    typed: (a) => a.email ?? '',
    parse(form, now) {
      const email = field(form, 'email').toLowerCase();
      const reason = field(form, 'reason');
      const until = futureDate(field(form, 'until'), now, 'The end date');
      const note = field(form, 'note');
      if (!EMAIL.test(email)) return 'Enter an email address.';
      if (!(REASONS as readonly string[]).includes(reason)) return 'Pick a reason.';
      if (typeof until !== 'string') return until.error;
      if (note.length > 500) return 'Keep the note to 500 characters.';
      return { email, reason, until, note, notify: field(form, 'notify') === '1' ? '1' : '' };
    },
    async preview(ctx, a) {
      const p = await opsAdmin<GrantPreview>(ctx.env, ctx.deps, ctx.actor, 'grants.preview', {
        email: a.email,
        until: a.until,
      });
      return {
        lines: [
          describeAccount(a.email ?? '', p),
          html`Gives <b>Pro</b> (${a.reason})
            ${endsText(a.until ?? '')}${p.has_account ? ', starting now' : ', from the moment this email first signs in (aliases included)'}.`,
          ...(p.active_grant
            ? [
                html`Replaces the current ${p.active_grant.reason} grant
                (${p.active_grant.expires_at ? `until ${day(p.active_grant.expires_at)}` : 'indefinite'}).`,
              ]
            : []),
          html`When it ends or is revoked, the account goes back to its own plan: its subscription,
          trial or Free. No data changes.`,
          ...(a.note ? [html`Note: ${a.note}`] : []),
          ...(a.notify
            ? senderConfigured(ctx.env)
              ? [html`Emails them "You've got Pro, on us", with how to start.`]
              : [html`No email: sending needs <code>RESEND_SEND_KEY</code>.`]
            : [html`No email to them.`]),
        ],
        button: 'Give Pro',
      };
    },
    async apply(ctx, a) {
      const { notify: _notify, ...grant } = a;
      const r = await opsAdmin<{ outcome: string }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'grants.grant',
        grant,
      );
      const done =
        r.outcome === 'pending'
          ? `Saved: ${a.email ?? ''} gets Pro when they first sign in.`
          : `${a.email ?? ''} has Pro (${a.reason ?? ''}).`;
      if (!a.notify || !senderConfigured(ctx.env)) return done;
      try {
        await sendEmails(
          ctx.env,
          ctx.deps,
          [
            {
              to: a.email ?? '',
              email: grantEmail({ until: a.until ?? '', hasAccount: r.outcome !== 'pending' }),
            },
          ],
          `grant-${a.email ?? ''}-${ctx.deps.now.toISOString()}`,
        );
        await audit(ctx, 'email.grant', { email: a.email }, '1 sent');
        return `${done} We emailed them.`;
      } catch (e) {
        await audit(ctx, 'email.grant', { email: a.email }, 'failed').catch(() => undefined);
        return `${done} The email didn't send (${e instanceof Error ? e.message : 'error'}).`;
      }
    },
  },

  'grant.revoke': {
    page: '/grants',
    title: 'Revoke a grant',
    typed: (a) => a.email ?? '',
    parse(form) {
      const email = field(form, 'email').toLowerCase();
      const note = field(form, 'note');
      if (!EMAIL.test(email)) return 'Enter an email address.';
      if (note.length > 500) return 'Keep the note to 500 characters.';
      return { email, note };
    },
    async preview(ctx, a) {
      const p = await opsAdmin<GrantPreview>(ctx.env, ctx.deps, ctx.actor, 'grants.preview', {
        email: a.email,
      });
      if (!p.active_grant && !p.complimentary)
        throw new ActionError(`${a.email ?? ''} has no grant to revoke.`);
      return {
        lines: [
          describeAccount(a.email ?? '', p),
          p.has_account
            ? html`Ends their grant now. The account goes back to its own plan (its subscription,
              trial or Free); data is never touched. The extension notices at its next plan check.`
            : html`Cancels the pending grant: they won't get Pro when they sign in.`,
        ],
        button: 'Revoke',
        danger: true,
      };
    },
    async apply(ctx, a) {
      const r = await opsAdmin<{ outcome: string }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'grants.revoke',
        a,
      );
      return r.outcome === 'revoked'
        ? `Revoked ${a.email ?? ''}'s grant.`
        : `${a.email ?? ''} had nothing to revoke.`;
    },
  },

  'account.two_step_off': {
    page: '/grants',
    title: 'Turn off two-step sign-in',
    typed: (a) => a.email ?? '',
    parse(form) {
      const email = field(form, 'email').toLowerCase();
      return EMAIL.test(email) ? { email } : 'Enter an email address.';
    },
    async preview(ctx, a) {
      const p = await opsAdmin<{ has_account: boolean; authenticators: number }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'accounts.two_step',
        { email: a.email },
      );
      if (!p.has_account) throw new ActionError(`${a.email ?? ''} has no account.`);
      if (!p.authenticators)
        throw new ActionError(`${a.email ?? ''} doesn't have two-step sign-in on.`);
      return {
        lines: [
          html`Removes <b>${p.authenticators}</b> authenticator
            app${p.authenticators === 1 ? '' : 's'} from <b>${a.email}</b> and signs them out on
            every device. They sign in again with an emailed code, and can turn two-step sign-in
            back on in Account.`,
          html`Only do this after checking it's them: they emailed from this address, and can answer
          something only they'd know (their plan, roughly when they signed up).`,
        ],
        button: 'Turn off',
        danger: true,
      };
    },
    async apply(ctx, a) {
      const r = await opsAdmin<{ outcome: string }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'accounts.two_step_off',
        a,
      );
      return r.outcome === 'removed'
        ? `Two-step sign-in is off for ${a.email ?? ''}; they're signed out everywhere.`
        : `${a.email ?? ''} had no authenticator.`;
    },
  },

  'code.create': {
    page: '/discounts',
    title: 'Create a discount code',
    parse(form, now) {
      const code = field(form, 'code').toUpperCase();
      const percent = Number(field(form, 'percent'));
      const intervals = INTERVALS.filter((i) => form.getAll('intervals').includes(i));
      const payments = field(form, 'payments');
      const until = futureDate(field(form, 'until'), now, 'The last day');
      const limitText = field(form, 'limit');
      const limit = limitText ? Number(limitText) : 0;
      if (!CODE.test(code)) return 'Codes are 3 to 20 letters and numbers.';
      if (!Number.isInteger(percent) || percent < 1 || percent > 90)
        return 'The discount is a whole percent from 1 to 90. Complimentary access is a grant, not a 100% code.';
      if (!intervals.length) return 'Pick at least one plan.';
      if (payments !== 'first' && payments !== 'three' && payments !== 'all')
        return 'Pick which payments it applies to.';
      if (typeof until !== 'string') return until.error;
      if (limitText && (!Number.isInteger(limit) || limit < 1 || limit > 100_000))
        return 'The usage limit is a whole number, or empty for none.';
      const offer = offerArgs(form, true);
      if (typeof offer === 'string') return offer;
      return {
        ...offer,
        code,
        percent: String(percent),
        intervals: intervals.join(','),
        payments,
        until,
        limit: limit ? String(limit) : '',
      };
    },
    async preview(ctx, a) {
      const existing = await listDiscounts(ctx.env, ctx.deps);
      if (existing.some((d) => d.code?.toUpperCase() === a.code && d.status === 'active'))
        throw new ActionError(`${a.code ?? ''} already exists in Paddle.`);
      const plans = (a.intervals ?? '').split(',').map((i) => INTERVAL_LABEL[i as Interval]);
      return {
        lines: [
          html`Creates <b>${a.code}</b> in <b>live Paddle</b>: ${a.percent}% off
            ${PAYMENTS_LABEL[a.payments as Payments]}, on ${plans.join(', ')}.`,
          html`Usable
          ${endsText(a.until ?? '')}${a.limit ? `, up to ${a.limit} times` : ', any number of times'}.`,
          html`Share it as a link: <code>https://rolestash.com/pricing/?code=${a.code}</code>, or
            people can type it on the pricing page or at checkout.`,
          ...(await offerLines(ctx, a, html`Then emails it.`)),
        ],
        button: a.segment ? 'Create and email' : 'Create code',
      };
    },
    async apply(ctx, a) {
      const created = await createCode(ctx.env, ctx.deps, {
        code: a.code ?? '',
        percent: Number(a.percent),
        intervals: (a.intervals ?? '').split(',') as Interval[],
        payments: a.payments as Payments,
        ...(a.until ? { until: a.until } : {}),
        ...(a.limit ? { limit: Number(a.limit) } : {}),
      });
      await audit(ctx, 'paddle.code.create', a, created.id);
      const done = `Created ${a.code ?? ''}. Link: https://rolestash.com/pricing/?code=${a.code ?? ''}`;
      if (!a.segment) return done;
      const offer = await codeOffer(ctx, created, a.message ?? '', false);
      try {
        const n = await sendOffer(ctx, a, 'code', (url) => codeEmail(offer, url));
        return `${done} ${sentText(n)}.`;
      } catch (e) {
        return `${done} The emails didn't send: ${e instanceof Error ? e.message : 'error'}`;
      }
    },
  },

  'code.archive': {
    page: '/discounts',
    title: 'Archive a discount code',
    parse(form) {
      const id = field(form, 'id');
      const code = field(form, 'code').toUpperCase();
      if (!/^dsc_[a-z0-9]{10,60}$/.test(id)) return 'Unknown discount.';
      const args: Args = { id };
      if (code) args.code = code;
      return args;
    },
    preview(_ctx, a) {
      return Promise.resolve({
        lines: [
          html`Archives <b>${a.code ?? a.id}</b> in live Paddle. It stops working at checkout
            straight away.`,
          html`People who already paid with it keep their discount on the payments it covered.`,
        ],
        button: 'Archive code',
        danger: true,
      });
    },
    async apply(ctx, a) {
      await archiveDiscount(ctx.env, ctx.deps, a.id ?? '');
      await audit(ctx, 'paddle.code.archive', a, 'archived');
      return `Archived ${a.code ?? a.id ?? ''}.`;
    },
  },

  'referrals.toggle': {
    page: '/referrals',
    title: 'Referral programme',
    parse(form) {
      const on = field(form, 'on');
      if (on !== '1' && on !== '0') return 'On or off?';
      if (on === '0') return { on };
      const offer = offerArgs(form, true);
      return typeof offer === 'string' ? offer : { on, ...offer };
    },
    async preview(ctx, a) {
      if (a.on === '1') {
        const s = await opsAdmin<{ settings: Record<string, unknown> }>(
          ctx.env,
          ctx.deps,
          ctx.actor,
          'referrals.summary',
        );
        if (typeof s.settings.referral_discount_id !== 'string')
          throw new ActionError(
            'Create the referral discount first (below), so friends get their discount.',
          );
        return {
          lines: [
            html`Turns the referral programme <b>on</b>. Account (extension and web board) shows
              each person their link.`,
            html`Friends get ${percentOf(s.settings)}% off their first monthly payment; referrers
            get a free month per friend who stays past 14 days (up to 12 a year).`,
            ...(await offerLines(ctx, a, html`Then announces it by email.`)),
          ],
          button: a.segment ? 'Turn on and email' : 'Turn on',
        };
      }
      return {
        lines: [
          html`Turns the referral programme <b>off</b>. Links stop giving discounts and Account
            hides the section.`,
          html`Referrals already recorded still qualify and are rewarded.`,
        ],
        button: 'Turn off',
        danger: true,
      };
    },
    async apply(ctx, a) {
      await opsAdmin(ctx.env, ctx.deps, ctx.actor, 'settings.set', {
        key: 'referrals_enabled',
        value: a.on === '1',
      });
      if (a.on !== '1') return 'Referrals are off.';
      if (!a.segment) return 'Referrals are on.';
      const s = await opsAdmin<{ settings: Record<string, unknown> }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'referrals.summary',
      );
      try {
        const n = await sendOffer(ctx, a, 'referrals', (url) =>
          referralEmail({ percent: percentOf(s.settings), note: a.message ?? '' }, url),
        );
        return `Referrals are on. ${sentText(n)}.`;
      } catch (e) {
        return `Referrals are on. The emails didn't send: ${e instanceof Error ? e.message : 'error'}`;
      }
    },
  },

  'referrals.discount': {
    page: '/referrals',
    title: "Friends' discount",
    parse(form) {
      const percent = Number(field(form, 'percent'));
      return Number.isInteger(percent) && percent >= 1 && percent <= 90
        ? { percent: String(percent) }
        : 'A whole percent from 1 to 90.';
    },
    async preview(ctx, a) {
      const s = await opsAdmin<{ settings: Record<string, unknown> }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'referrals.summary',
      );
      const current = s.settings.referral_discount_id;
      return {
        lines: [
          html`Creates a discount in <b>live Paddle</b>: ${a.percent}% off a referred friend's first
            monthly payment. It can't be typed at checkout; only referral links use it.`,
          ...(typeof current === 'string'
            ? [
                html`New referral checkouts use it from now on; the current one
                (${percentOf(s.settings)}%) is archived.`,
              ]
            : []),
        ],
        button: 'Create discount',
      };
    },
    async apply(ctx, a) {
      const s = await opsAdmin<{ settings: Record<string, unknown> }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'referrals.summary',
      );
      const created = await createReferralDiscount(ctx.env, ctx.deps, Number(a.percent));
      await opsAdmin(ctx.env, ctx.deps, ctx.actor, 'settings.set', {
        key: 'referral_discount_id',
        value: created.id,
      });
      await opsAdmin(ctx.env, ctx.deps, ctx.actor, 'settings.set', {
        key: 'referral_percent',
        value: Number(a.percent),
      });
      const old = s.settings.referral_discount_id;
      if (typeof old === 'string' && old !== created.id)
        await archiveDiscount(ctx.env, ctx.deps, old).catch(() => undefined);
      await audit(ctx, 'paddle.referral_discount', a, created.id);
      return `Friends now get ${a.percent ?? ''}% off their first month.`;
    },
  },

  'referrals.void': {
    page: '/referrals',
    title: 'Void a referral',
    parse(form) {
      const id = field(form, 'id');
      return /^\d{1,12}$/.test(id)
        ? { id, friend: field(form, 'friend').slice(0, 100) }
        : 'Unknown referral.';
    },
    preview(_ctx, a) {
      return Promise.resolve({
        lines: [
          html`Voids referral #${a.id}${a.friend ? ` (${a.friend})` : ''}: the referrer gets no
          month for it.`,
          html`Use it for abuse: the same person on two accounts, a friend who asked for their money
          back another way.`,
        ],
        button: 'Void referral',
        danger: true,
      });
    },
    async apply(ctx, a) {
      const r = await opsAdmin<{ outcome: string }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'referrals.void',
        {
          id: Number(a.id),
          note: 'voided from the dashboard',
        },
      );
      return r.outcome === 'void'
        ? `Voided referral #${a.id ?? ''}.`
        : `Referral #${a.id ?? ''} can't be voided now.`;
    },
  },

  'referrals.run': {
    page: '/referrals',
    title: 'Run referrals now',
    parse() {
      return {};
    },
    preview() {
      return Promise.resolve({
        lines: [
          html`Runs today's referral step now (it also runs every day by itself):`,
          html`referrals older than 14 days with no refund qualify; Free referrers get a 30-day
          grant; paying referrers' next renewal moves out a month in Paddle, at no charge.`,
        ],
        button: 'Run now',
      });
    },
    async apply(ctx) {
      const s = await runReferralJob(ctx.env, ctx.deps, ctx.actor);
      return `Done: ${String(s.qualified)} qualified, ${String(s.granted + s.paddleFallback)} months as grants, ${String(s.paddleMoved)} renewals moved${s.failed ? `, ${String(s.failed)} failed (they'll be retried)` : ''}.`;
    },
  },

  'offer.code': {
    page: '/emails',
    title: 'Email a discount code',
    parse(form) {
      const id = field(form, 'id');
      if (!/^dsc_[a-z0-9]{10,60}$/.test(id)) return 'Pick a live code.';
      const offer = offerArgs(form, false);
      return typeof offer === 'string' ? offer : { id, ...offer };
    },
    async preview(ctx, a) {
      const d = await liveCode(ctx, a.id ?? '');
      return {
        lines: [
          html`Emails <b>${d.code}</b> (${d.amount}% off) with its pricing link, which applies it at
            checkout.`,
          ...(await offerLines(ctx, a, html``)),
          ...(a.message ? [html`Personal line: ${a.message}`] : []),
        ],
        button: 'Send emails',
      };
    },
    async apply(ctx, a) {
      const d = await liveCode(ctx, a.id ?? '');
      const offer = await codeOffer(ctx, d, a.message ?? '', false);
      const n = await sendOffer(ctx, { ...a, code: d.code ?? '' }, 'code', (url) =>
        codeEmail(offer, url),
      );
      return `${d.code ?? ''}: ${sentText(n)}.`;
    },
  },

  'offer.targeted': {
    page: '/emails',
    title: 'Send a targeted discount',
    parse(form) {
      const percent = Number(field(form, 'percent'));
      const days = Number(field(form, 'days'));
      const intervals = INTERVALS.filter((i) => form.getAll('intervals').includes(i));
      const payments = field(form, 'payments');
      if (!Number.isInteger(percent) || percent < 1 || percent > 90)
        return 'The discount is a whole percent from 1 to 90.';
      if (!Number.isInteger(days) || days < 1 || days > 90) return 'It lasts 1 to 90 days.';
      if (!intervals.length) return 'Pick at least one plan.';
      if (payments !== 'first' && payments !== 'three' && payments !== 'all')
        return 'Pick which payments it applies to.';
      const offer = offerArgs(form, false);
      if (typeof offer === 'string') return offer;
      return {
        ...offer,
        percent: String(percent),
        days: String(days),
        intervals: intervals.join(','),
        payments,
      };
    },
    async preview(ctx, a) {
      const until = sydneyDayAfter(ctx.deps.now, Number(a.days));
      const plans = (a.intervals ?? '').split(',').map((i) => INTERVAL_LABEL[i as Interval]);
      return {
        lines: [
          html`Creates a new code in <b>live Paddle</b> just for them: ${a.percent}% off
            ${PAYMENTS_LABEL[a.payments as Payments]}, on ${plans.join(', ')}, usable until the end
            of ${day(`${until}T12:00:00+10:00`)} and only as many times as people emailed.`,
          ...(await offerLines(ctx, a, html`Then emails each of them the code.`)),
          ...(a.message ? [html`Personal line: ${a.message}`] : []),
        ],
        button: 'Create and send',
      };
    },
    async apply(ctx, a) {
      const { count } = await describeAudience(ctx, a);
      if (!count) throw new ActionError('Nobody in that audience can get an offer right now.');
      const until = sydneyDayAfter(ctx.deps.now, Number(a.days));
      const code = targetedCode();
      const created = await createCode(ctx.env, ctx.deps, {
        code,
        percent: Number(a.percent),
        intervals: (a.intervals ?? '').split(',') as Interval[],
        payments: a.payments as Payments,
        until,
        limit: count,
      });
      await audit(
        ctx,
        'paddle.code.create',
        { code, segment: a.segment, targeted: true },
        created.id,
      );
      const offer = await codeOffer(ctx, created, a.message ?? '', true);
      offer.until = until;
      const n = await sendOffer(ctx, { ...a, code }, 'targeted', (url) => codeEmail(offer, url));
      return `Created ${code} and sent ${sentText(n)}.`;
    },
  },

  'offer.referrals': {
    page: '/emails',
    title: 'Announce referrals',
    parse(form) {
      const offer = offerArgs(form, false);
      return offer;
    },
    async preview(ctx, a) {
      const s = await opsAdmin<{ settings: Record<string, unknown> }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'referrals.summary',
      );
      if (s.settings.referrals_enabled !== true)
        throw new ActionError('Turn the referral programme on first.');
      return {
        lines: [
          html`Emails "Share Rolestash, get free months of Pro": friends get
          ${percentOf(s.settings)}% off, they get a free month per friend.`,
          ...(await offerLines(ctx, a, html``)),
          ...(a.message ? [html`Personal line: ${a.message}`] : []),
        ],
        button: 'Send emails',
      };
    },
    async apply(ctx, a) {
      const s = await opsAdmin<{ settings: Record<string, unknown> }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'referrals.summary',
      );
      const n = await sendOffer(ctx, a, 'referrals', (url) =>
        referralEmail({ percent: percentOf(s.settings), note: a.message ?? '' }, url),
      );
      return `Referral announcement: ${sentText(n)}.`;
    },
  },
};
