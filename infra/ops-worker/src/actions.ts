import { opsAdmin } from './admin';
import { html, type Html } from './html';
import { runReferralJob } from './jobs';
import {
  archiveDiscount,
  createCode,
  createReferralDiscount,
  INTERVAL_LABEL,
  INTERVALS,
  listDiscounts,
  PAYMENTS_LABEL,
  type Interval,
  type Payments,
} from './paddle-admin';
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
}

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
      return { email, reason, until, note };
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
        ],
        button: 'Give Pro',
      };
    },
    async apply(ctx, a) {
      const r = await opsAdmin<{ outcome: string }>(
        ctx.env,
        ctx.deps,
        ctx.actor,
        'grants.grant',
        a,
      );
      return r.outcome === 'pending'
        ? `Saved: ${a.email ?? ''} gets Pro when they first sign in.`
        : `${a.email ?? ''} has Pro (${a.reason ?? ''}).`;
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
      return {
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
        ],
        button: 'Create code',
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
      return `Created ${a.code ?? ''}. Link: https://rolestash.com/pricing/?code=${a.code ?? ''}`;
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
      return on === '1' || on === '0' ? { on } : 'On or off?';
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
          ],
          button: 'Turn on',
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
      return a.on === '1' ? 'Referrals are on.' : 'Referrals are off.';
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
};
