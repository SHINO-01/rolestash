import type { REPORT_STATUSES } from './actions';
import { REASONS, REPORT_VIEWS } from './actions';
import { adminConfigured, opsAdmin } from './admin';
import { senderConfigured } from './emails';
import { html, type Html } from './html';
import {
  INTERVAL_LABEL,
  INTERVALS,
  isLive,
  listDiscounts,
  paddleConfigured,
  proPrices,
  PAYMENTS_LABEL,
  type Discount,
} from './paddle-admin';
import {
  allPanels,
  fetchStats,
  payingCount,
  plural,
  statNumber,
  type Deps,
  type Env,
  type Panel,
  type Stats,
} from './panels';
import { audienceFields } from './offers';
import { actionForm, day, dayTime, errorBox, notice, pageHead, panelCard } from './views';

/**
 * The dashboard's pages (ADR-0037). Each loads what it shows, never more,
 * and fails in place: a provider that can't be reached shows an error card,
 * and the rest of the page still renders.
 */

export interface PageContext {
  env: Env;
  deps: Deps;
  email: string;
  /** The first-step token for an action's form. */
  token: (action: string) => Promise<string>;
  notice?: string;
}

export interface Rendered {
  title: string;
  body: Html;
  counts?: { grants?: number; referrals?: number; reports?: number };
}

const safeMessage = (error: unknown): string =>
  error instanceof Error &&
  ['AdminError', 'PaddleAdminError', 'ActionError', 'SendError'].includes(error.name)
    ? error.message
    : error instanceof Error && /^HTTP \d{3}$/.test(error.message)
      ? `Couldn't load (${error.message}).`
      : "Couldn't load.";

async function attempt<T>(run: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await run() };
  } catch (error) {
    return { error: safeMessage(error) };
  }
}

const setupCard = (what: string, steps: Html): Html =>
  html`<section class="card">
    <h2>Set up ${what}</h2>
    <p class="setup">${steps}</p>
  </section>`;

const ADMIN_SETUP = setupCard(
  'changes',
  html`The dashboard needs its admin secret to change anything: run
    <code>npx tsx scripts/ops-secret.ts</code> (docs/guides/operations.md).`,
);
const PADDLE_SETUP = setupCard(
  'Paddle',
  html`Add <code>PADDLE_API_KEY</code> with read access plus Discounts and Subscriptions write
    (docs/guides/operations.md).`,
);

// ── Overview ────────────────────────────────────────────────────────────────

interface Overview {
  grants_active?: number;
  grants_pending?: number;
  grants_ending_14d?: number;
  referrals_enabled?: boolean;
  referrals_pending?: number;
  referrals_awaiting_paddle?: number;
  referrals_rewarded_30d?: number;
  reports_new?: number;
  reports_open?: number;
  last_change?: { at: string; actor: string; action: string; outcome: string } | null;
}

function kpi(label: string, value: string | number, detail?: string): Html {
  return html`<div class="kpi">
    <div class="n">${value}</div>
    <div class="l">${label}</div>
    ${detail ? html`<div class="d">${detail}</div>` : null}
  </div>`;
}

export async function overviewPage(ctx: PageContext): Promise<Rendered> {
  const stats: Stats | null = await fetchStats(ctx.env, ctx.deps).catch(() => null);
  const [panels, programmes] = await Promise.all([
    allPanels(ctx.env, ctx.deps, stats),
    adminConfigured(ctx.env)
      ? opsAdmin<Overview>(ctx.env, ctx.deps, ctx.email, 'overview').catch(() => null)
      : Promise.resolve(null),
  ]);

  const attention: { text: string; href?: string }[] = [];
  const pastDue = statNumber(stats, 'past_due');
  const revenue = panels.find((p) => p.title.startsWith('Revenue'));
  // Paddle's panel says it too when it's set up; say it once.
  if (pastDue && revenue?.status !== 'attention')
    attention.push({
      text: `${plural(pastDue, 'subscription')} past due`,
      href: 'https://vendors.paddle.com/',
    });
  for (const p of panels.filter((x) => x.status === 'attention' || x.status === 'error'))
    attention.push({
      text: `${p.title}: ${p.status === 'error' ? (p.note ?? 'error') : (p.alert ?? '') === '' ? 'needs a look' : p.alert}`,
      ...(p.link ? { href: p.link.href } : {}),
    });
  if (programmes?.referrals_awaiting_paddle)
    attention.push({
      text: `${plural(programmes.referrals_awaiting_paddle, 'referral month')} waiting for Paddle`,
      href: '/referrals',
    });
  if (programmes?.reports_new)
    attention.push({
      text: plural(programmes.reports_new, 'new problem report'),
      href: '/reports',
    });
  if (programmes?.grants_ending_14d)
    attention.push({
      text: `${plural(programmes.grants_ending_14d, 'grant')} ending in the next 14 days`,
      href: '/grants',
    });

  const live = panels.filter((p) => p.status !== 'not_configured');
  const missing = panels.filter((p) => p.status === 'not_configured');
  const when = dayTime(ctx.deps.now.toISOString());

  const body = html`${pageHead('Overview', `Live numbers, loaded ${when} (Sydney). Reload for fresh ones.`)}
    <div class="stack">
      ${notice(ctx.notice)}
      <section class="card">
        <h2>Needs attention</h2>
        ${
          attention.length
            ? html`<ul class="attention">
                ${attention.map((a) => html`<li>${a.text}${a.href ? html`<a href="${a.href}">Open</a>` : null}</li>`)}
              </ul>`
            : html`<p class="allclear">All clear.</p>`
        }
      </section>
      ${
        stats
          ? html`<div class="kpis">
              ${kpi('Paying', payingCount(stats), `${String(statNumber(stats, 'cancelling'))} cancelling`)}
              ${kpi('On trial', statNumber(stats, 'trials_active'))}
              ${kpi('Accounts', statNumber(stats, 'accounts'), `${String(statNumber(stats, 'signups_7d'))} new this week`)}
              ${kpi('Complimentary', statNumber(stats, 'complimentary'), programmes?.grants_pending ? `${String(programmes.grants_pending)} waiting for sign-up` : undefined)}
              ${kpi('Referrals', programmes?.referrals_enabled ? (programmes.referrals_rewarded_30d ?? 0) : 'Off', programmes?.referrals_enabled ? `rewarded in 30 days · ${String(programmes.referrals_pending ?? 0)} pending` : 'turn on in Referrals')}
            </div>`
          : null
      }
      <div class="grid">${live.map(panelCard)}</div>
      ${
        missing.length
          ? html`<p class="setup">
              Not set up: ${missing.map((p, i) => html`${i ? ', ' : ''}${p.title}`)}. Each needs its
              token (docs/guides/operations.md).
            </p>`
          : null
      }
      ${programmes?.last_change ? html`<p class="setup">Last change: ${programmes.last_change.action} by ${programmes.last_change.actor}, ${dayTime(programmes.last_change.at)}. <a href="/activity">Activity</a></p>` : null}
    </div>`;
  return {
    title: 'Overview',
    body,
    counts: {
      grants: programmes?.grants_active,
      referrals: programmes?.referrals_awaiting_paddle,
      reports: programmes?.reports_new,
    },
  };
}

// ── Problem reports ─────────────────────────────────────────────────────────

interface ReportRow {
  id: number;
  created_at: string;
  message: string;
  contact_email: string | null;
  context: Record<string, string>;
  status: (typeof REPORT_STATUSES)[number];
  signed_in: boolean;
  plan_status: string | null;
}

interface ReportList {
  by_status: Record<string, number>;
  reports: ReportRow[];
}

const VIEW_LABEL: Record<(typeof REPORT_VIEWS)[number], string> = {
  open: 'Open',
  new: 'New',
  seen: 'Seen',
  fixed: 'Fixed',
  closed: 'Closed',
  all: 'All',
};

const CONTEXT_LABEL: [key: string, label: string][] = [
  ['version', 'Version'],
  ['browser', 'Browser'],
  ['platform', 'System'],
  ['plan', 'Plan'],
  ['where', 'From'],
  ['page', 'Page'],
];

/** What people sent from "Report a problem" (ADR-0024), to read, reply to and close. */
export async function reportsPage(ctx: PageContext, wanted: string): Promise<Rendered> {
  if (!adminConfigured(ctx.env))
    return { title: 'Problem reports', body: html`${pageHead('Problem reports')}${ADMIN_SETUP}` };
  const view = (REPORT_VIEWS as readonly string[]).includes(wanted)
    ? (wanted as (typeof REPORT_VIEWS)[number])
    : 'open';
  const [list, statusToken] = await Promise.all([
    attempt(() =>
      opsAdmin<ReportList>(ctx.env, ctx.deps, ctx.email, 'reports.list', { status: view }),
    ),
    ctx.token('report.status'),
  ]);
  const counts = 'ok' in list ? list.ok.by_status : {};
  const count = (v: (typeof REPORT_VIEWS)[number]) =>
    v === 'all'
      ? Object.values(counts).reduce((a, b) => a + b, 0)
      : v === 'open'
        ? (counts.new ?? 0) + (counts.seen ?? 0)
        : (counts[v] ?? 0);
  const next: Record<ReportRow['status'], ReportRow['status'][]> = {
    new: ['seen', 'fixed', 'closed'],
    seen: ['fixed', 'closed'],
    fixed: ['new', 'closed'],
    closed: ['new'],
  };
  const reply = (r: ReportRow) =>
    r.contact_email
      ? `mailto:${encodeURIComponent(r.contact_email)}?subject=${encodeURIComponent(`Re: your Rolestash report #${String(r.id)}`)}`
      : null;

  const card = (r: ReportRow) => {
    const mail = reply(r);
    return html`<section class="card">
      <h2>
        <span
          >#${r.id}
          <span
            class="pill ${r.status === 'new' ? 'pending' : r.status === 'fixed' ? 'ok' : r.status === 'closed' ? 'void' : ''}"
            >${r.status}</span
          ></span
        ><span class="faint">${dayTime(r.created_at)}</span>
      </h2>
      <blockquote class="report">${r.message}</blockquote>
      <div class="report-meta">
        <span
          >${r.contact_email ? html`Reply to <b>${r.contact_email}</b>` : 'No email given'}${r.signed_in ? html` · account${r.plan_status ? ` (${r.plan_status})` : ''}` : ' · signed out'}</span
        >
        ${CONTEXT_LABEL.filter(([k]) => r.context[k]).map(
          ([k, label]) => html`<span>${label}: ${r.context[k]}</span>`,
        )}
      </div>
      <div class="actions report-actions">
        ${mail ? html`<a class="btn small primary" href="${mail}">Reply by email</a>` : null}
        ${next[r.status].map((to) =>
          actionForm(
            'report.status',
            statusToken,
            html`<input type="hidden" name="id" value="${r.id}" /><input
                type="hidden"
                name="status"
                value="${to}"
              /><input type="hidden" name="view" value="${view}" /><button class="btn small">
                ${to === 'new' ? 'Reopen' : `Mark ${to}`}
              </button>`,
          ),
        )}
      </div>
    </section>`;
  };

  const body = html`${pageHead('Problem reports', 'What people send from “Report a problem” in the extension (board, popup and widget). Each one is also emailed to support. Reports are deleted after 12 months.')}
    <div class="stack">
      ${notice(ctx.notice)}
      <nav class="tabs" aria-label="Filter">
        ${REPORT_VIEWS.map(
          (v) =>
            html`<a
              href="${v === 'open' ? '/reports' : `/reports?status=${v}`}"
              ${v === view ? html` aria-current="page"` : null}
              >${VIEW_LABEL[v]} ${count(v)}</a
            >`,
        )}
      </nav>
      ${
        'error' in list
          ? errorBox(list.error)
          : list.ok.reports.length
            ? list.ok.reports.map(card)
            : html`<p class="allclear">
                ${view === 'open' ? 'No open reports.' : `No ${VIEW_LABEL[view].toLowerCase()} reports.`}
              </p>`
      }
    </div>`;
  return { title: 'Problem reports', body, counts: { reports: counts.new } };
}

// ── Grants ──────────────────────────────────────────────────────────────────

interface GrantRow {
  id: number;
  email: string | null;
  reason: string;
  expires_at: string | null;
  note: string | null;
  granted_at: string;
  granted_by: string;
  state: 'active' | 'pending' | 'revoked';
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_note: string | null;
}

export async function grantsPage(ctx: PageContext, showAll: boolean): Promise<Rendered> {
  if (!adminConfigured(ctx.env))
    return { title: 'Grants', body: html`${pageHead('Grants')}${ADMIN_SETUP}` };
  const [list, giveToken, revokeToken, twoStepToken] = await Promise.all([
    attempt(() =>
      opsAdmin<GrantRow[]>(ctx.env, ctx.deps, ctx.email, 'grants.list', { all: showAll }),
    ),
    ctx.token('grant.give'),
    ctx.token('grant.revoke'),
    ctx.token('account.two_step_off'),
  ]);
  const rows = 'ok' in list ? list.ok : [];
  const active = rows.filter((g) => g.state !== 'revoked').length;
  const body = html`${pageHead('Grants', 'Complimentary Pro: indefinite or until a date, revocable, logged.')}
    <div class="stack">
      ${notice(ctx.notice)}
      <section class="card">
        <h2>Give Pro</h2>
        ${actionForm(
          'grant.give',
          giveToken,
          html`<div class="form">
            <label class="wide"
              >Email<input
                name="email"
                type="email"
                required
                autocomplete="off"
                placeholder="name@example.com"
            /></label>
            <label
              >Reason<select name="reason">
                ${REASONS.filter((r) => r !== 'referral').map((r) => html`<option>${r}</option>`)}
              </select></label
            >
            <label>Until (optional)<input name="until" type="date" /></label>
            <label class="wide"
              >Note (optional)<input name="note" maxlength="500" placeholder="Why, for the log"
            /></label>
            <fieldset class="wide">
              <label
                ><input type="checkbox" name="notify" value="1" checked /> Email them that they've
                got Pro</label
              >
            </fieldset>
            <div class="actions wide">
              <button class="btn primary">Preview</button
              ><span class="faint">No account yet? It applies when they first sign in.</span>
            </div>
          </div>`,
        )}
      </section>
      <section class="card">
        <h2>
          ${showAll ? 'All grants' : 'Active grants'}
          <a class="btn link" href="${showAll ? '/grants' : '/grants?all=1'}"
            >${showAll ? 'Active only' : 'Show revoked too'}</a
          >
        </h2>
        ${'error' in list ? errorBox(list.error) : null}
        ${
          rows.length
            ? html`<div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Reason</th>
                      <th>Until</th>
                      <th>Note</th>
                      <th>Given</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(
                      (g) =>
                        html`<tr>
                          <td>
                            ${g.email ?? '(deleted account)'}
                            ${g.state === 'pending' ? html`<span class="pill pending">waiting for sign-up</span>` : g.state === 'revoked' ? html`<span class="pill void">revoked</span>` : null}
                          </td>
                          <td>${g.reason}</td>
                          <td>
                            ${g.expires_at ? day(g.expires_at) : 'indefinite'}
                            ${
                              g.state !== 'revoked' &&
                              g.expires_at &&
                              Date.parse(g.expires_at) - ctx.deps.now.getTime() < 14 * 86_400_000
                                ? html`<br /><span class="pill pending">ends soon</span>`
                                : null
                            }
                          </td>
                          <td class="muted">
                            ${g.note ?? ''}${g.revoked_at ? html`<br /><span class="faint">Revoked ${day(g.revoked_at)} by ${g.revoked_by ?? '?'}${g.revoke_note ? `: ${g.revoke_note}` : ''}</span>` : null}
                          </td>
                          <td class="faint">${day(g.granted_at)}<br />${g.granted_by}</td>
                          <td class="r">
                            ${
                              g.state !== 'revoked' && g.email
                                ? actionForm(
                                    'grant.revoke',
                                    revokeToken,
                                    html`<input
                                        type="hidden"
                                        name="email"
                                        value="${g.email}"
                                      /><button class="btn small danger">Revoke</button>`,
                                  )
                                : null
                            }
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<p class="faint">No grants${showAll ? '' : ' active'}.</p>`
        }
      </section>
      <section class="card">
        <h2>Account help: lost authenticator</h2>
        <p class="muted">
          Someone with two-step sign-in lost their phone? Check it's them first, then turn it off:
          they sign in with an emailed code and can turn it on again.
        </p>
        ${actionForm(
          'account.two_step_off',
          twoStepToken,
          html`<div class="actions">
            <input
              name="email"
              type="email"
              required
              autocomplete="off"
              placeholder="name@example.com"
            /><button class="btn">Preview</button>
          </div>`,
        )}
      </section>
    </div>`;
  return { title: 'Grants', body, counts: { grants: active } };
}

// ── Discount codes ──────────────────────────────────────────────────────────

const plansOf = (d: Discount, prices?: Record<string, string>) => {
  if (!d.restrictTo) return 'all prices';
  if (!prices) return `${String(d.restrictTo.length)} price(s)`;
  const names = INTERVALS.filter((i) => d.restrictTo?.includes(prices[i] ?? '')).map(
    (i) => INTERVAL_LABEL[i],
  );
  return names.length ? names.join(', ') : 'other prices';
};

const appliesTo = (d: Discount) =>
  !d.recur
    ? 'first payment'
    : d.maxRecurring
      ? `first ${String(d.maxRecurring)} payments`
      : 'every payment';

export async function discountsPage(ctx: PageContext): Promise<Rendered> {
  if (!adminConfigured(ctx.env))
    return { title: 'Discount codes', body: html`${pageHead('Discount codes')}${ADMIN_SETUP}` };
  if (!paddleConfigured(ctx.env))
    return { title: 'Discount codes', body: html`${pageHead('Discount codes')}${PADDLE_SETUP}` };
  const [list, prices, createToken, archiveToken] = await Promise.all([
    attempt(() => listDiscounts(ctx.env, ctx.deps)),
    proPrices(ctx.env, ctx.deps).catch(() => undefined),
    ctx.token('code.create'),
    ctx.token('code.archive'),
  ]);
  const all = 'ok' in list ? list.ok.filter((d) => d.kind !== 'referral' && d.code) : [];
  const live = all.filter((d) => isLive(d, ctx.deps.now));
  const ended = all.filter((d) => !isLive(d, ctx.deps.now));
  const table = (rows: Discount[], archive: boolean) =>
    html`<div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Off</th>
            <th>Plans</th>
            <th>Applies to</th>
            <th class="r">Used</th>
            <th>Ends</th>
            ${archive ? html`<th></th>` : null}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (d) =>
              html`<tr>
                <td>
                  <b>${d.code}</b><br /><a
                    class="faint"
                    href="https://rolestash.com/pricing/?code=${d.code}"
                    rel="noopener noreferrer"
                    >rolestash.com/pricing/?code=${d.code}</a
                  >
                </td>
                <td>${d.type === 'percentage' ? `${d.amount}%` : d.amount}</td>
                <td>${plansOf(d, prices)}</td>
                <td>${appliesTo(d)}</td>
                <td class="num">
                  ${d.timesUsed}${d.usageLimit ? ` / ${String(d.usageLimit)}` : ''}
                </td>
                <td>${d.expiresAt ? day(d.expiresAt) : '—'}</td>
                ${archive ? html`<td class="r">${actionForm('code.archive', archiveToken, html`<input type="hidden" name="id" value="${d.id}" /><input type="hidden" name="code" value="${d.code ?? ''}" /><button class="btn small danger">Archive</button>`)}</td>` : null}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;

  const body = html`${pageHead('Discount codes', 'Paddle discounts for the Pro prices. One discount per payment; with a referral too, the bigger one applies.')}
    <div class="stack">
      ${notice(ctx.notice)}
      <section class="card">
        <h2>New code</h2>
        ${actionForm(
          'code.create',
          createToken,
          html`<div class="form">
            <label
              >Code<input
                name="code"
                required
                pattern="[A-Za-z0-9]{3,20}"
                maxlength="20"
                placeholder="LAUNCH30"
                autocomplete="off"
            /></label>
            <label
              >Percent off<input
                name="percent"
                type="number"
                min="1"
                max="90"
                required
                placeholder="30"
            /></label>
            <label
              >Applies to<select name="payments">
                ${(['first', 'three', 'all'] as const).map((p) => html`<option value="${p}">${PAYMENTS_LABEL[p]}</option>`)}
              </select></label
            >
            <label>Last day (optional)<input name="until" type="date" /></label>
            <label
              >Usage limit (optional)<input name="limit" type="number" min="1" placeholder="200"
            /></label>
            <fieldset class="wide">
              <legend>Plans</legend>
              ${INTERVALS.map((i) => html`<label><input type="checkbox" name="intervals" value="${i}" checked /> ${INTERVAL_LABEL[i]}</label>`)}
            </fieldset>
            ${audienceFields('Nobody: I’ll share it myself')}
            <div class="actions wide"><button class="btn primary">Preview</button></div>
          </div>`,
        )}
      </section>
      <section class="card">
        <h2>Live codes</h2>
        ${'error' in list ? errorBox(list.error) : live.length ? table(live, true) : html`<p class="faint">No live codes.</p>`}
      </section>
      ${
        ended.length
          ? html`<section class="card">
              <details>
                <summary>Ended or archived (${ended.length})</summary>
                ${table(ended, false)}
              </details>
            </section>`
          : null
      }
    </div>`;
  return { title: 'Discount codes', body };
}

// ── Emails ──────────────────────────────────────────────────────────────────

interface EmailsSummary {
  opted_out: number;
  emailed_7d: number;
  recent: {
    at: string;
    actor: string;
    action: string;
    detail: Record<string, unknown>;
    outcome: string;
  }[];
}

const EMAIL_KIND: Record<string, string> = {
  'email.grant': 'Complimentary Pro',
  'email.code': 'Discount code',
  'email.targeted': 'Targeted discount',
  'email.referrals': 'Referral announcement',
  'email.recipients': 'Recipients picked',
};

export async function emailsPage(ctx: PageContext): Promise<Rendered> {
  if (!adminConfigured(ctx.env))
    return { title: 'Emails', body: html`${pageHead('Emails')}${ADMIN_SETUP}` };
  const [summary, codes, targetedToken, codeToken, referralsToken] = await Promise.all([
    attempt(() => opsAdmin<EmailsSummary>(ctx.env, ctx.deps, ctx.email, 'emails.summary')),
    paddleConfigured(ctx.env)
      ? attempt(() => listDiscounts(ctx.env, ctx.deps))
      : Promise.resolve({ ok: [] as Discount[] }),
    ctx.token('offer.targeted'),
    ctx.token('offer.code'),
    ctx.token('offer.referrals'),
  ]);
  const live =
    'ok' in codes
      ? codes.ok.filter((d) => d.kind !== 'referral' && d.code && isLive(d, ctx.deps.now))
      : [];
  const sendSetup = senderConfigured(ctx.env)
    ? null
    : setupCard(
        'sending',
        html`Add <code>RESEND_SEND_KEY</code>, a Resend key with sending access only
          (docs/guides/operations.md).`,
      );
  const s = 'ok' in summary ? summary.ok : undefined;
  const body = html`${pageHead('Emails', 'Offers to people with an account, at most one a week each, always with a one-click opt-out. Complimentary Pro emails go out from Grants.')}
    <div class="stack">
      ${notice(ctx.notice)} ${sendSetup}
      ${
        s
          ? html`<div class="kpis">
              ${kpi('Emailed an offer in the last 7 days', s.emailed_7d, 'They get no other offer until the week is up')}
              ${kpi('Opted out of offers', s.opted_out)}
            </div>`
          : errorBox('error' in summary ? summary.error : undefined)
      }
      <section class="card">
        <h2>Send a targeted discount</h2>
        <p class="muted">
          A new code just for the people you pick, usable only as many times as people emailed, for
          a few days. Good for a trial that just ended, or someone who left.
        </p>
        ${
          paddleConfigured(ctx.env)
            ? actionForm(
                'offer.targeted',
                targetedToken,
                html`<div class="form">
                  <label
                    >Percent off<input
                      name="percent"
                      type="number"
                      min="1"
                      max="90"
                      required
                      placeholder="40"
                  /></label>
                  <label
                    >Applies to<select name="payments">
                      ${(['first', 'three', 'all'] as const).map((p) => html`<option value="${p}">${PAYMENTS_LABEL[p]}</option>`)}
                    </select></label
                  >
                  <label
                    >Days to use it<input
                      name="days"
                      type="number"
                      min="1"
                      max="90"
                      value="14"
                      required
                  /></label>
                  <fieldset class="wide">
                    <legend>Plans</legend>
                    ${INTERVALS.map((i) => html`<label><input type="checkbox" name="intervals" value="${i}" checked /> ${INTERVAL_LABEL[i]}</label>`)}
                  </fieldset>
                  ${audienceFields(null, 'trial_ended')}
                  <div class="actions wide"><button class="btn primary">Preview</button></div>
                </div>`,
              )
            : html`<p class="setup">Needs <code>PADDLE_API_KEY</code> with Discounts write.</p>`
        }
      </section>
      <div class="two">
        <section class="card">
          <h2>Email a live code</h2>
          ${
            live.length
              ? actionForm(
                  'offer.code',
                  codeToken,
                  html`<div class="form">
                    <label class="wide"
                      >Code<select name="id">
                        ${live.map((d) => html`<option value="${d.id}">${d.code} (${d.amount}% off)</option>`)}
                      </select></label
                    >
                    ${audienceFields(null, 'free')}
                    <div class="actions wide"><button class="btn primary">Preview</button></div>
                  </div>`,
                )
              : html`<p class="faint">No live codes. Create one under Discount codes.</p>`
          }
        </section>
        <section class="card">
          <h2>Announce referrals</h2>
          ${actionForm(
            'offer.referrals',
            referralsToken,
            html`<div class="form">
              ${audienceFields(null, 'everyone')}
              <div class="actions wide"><button class="btn primary">Preview</button></div>
            </div>`,
          )}
        </section>
      </div>
      <section class="card">
        <h2>Recent sends</h2>
        ${
          s?.recent.length
            ? html`<div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>What</th>
                      <th>Who</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${s.recent.map(
                      (r) =>
                        html`<tr>
                          <td class="faint">${dayTime(r.at)}</td>
                          <td>
                            ${EMAIL_KIND[r.action] ?? r.action}${typeof r.detail.code === 'string' ? html` <b>${r.detail.code}</b>` : null}
                          </td>
                          <td class="muted">
                            ${typeof r.detail.email === 'string' ? r.detail.email : typeof r.detail.segment === 'string' ? r.detail.segment : ''}
                          </td>
                          <td>${r.outcome}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<p class="faint">Nothing sent yet.</p>`
        }
      </section>
    </div>`;
  return { title: 'Emails', body };
}

// ── Referrals ───────────────────────────────────────────────────────────────

interface ReferralSummary {
  settings: Record<string, unknown>;
  codes: number;
  by_status: Record<string, number>;
  awaiting_paddle: number;
  top: { email: string | null; joined: number; earned: number }[];
  recent: {
    id: number;
    referrer: string | null;
    friend: string | null;
    status: string;
    reward: string | null;
    note: string | null;
    created_at: string;
    rewarded_at: string | null;
  }[];
}

const REWARD_LABEL: Record<string, string> = {
  paddle_month: 'renewal moved',
  grant_month: '30-day grant',
  not_needed: 'had a grant already',
};

export async function referralsPage(ctx: PageContext): Promise<Rendered> {
  if (!adminConfigured(ctx.env))
    return { title: 'Referrals', body: html`${pageHead('Referrals')}${ADMIN_SETUP}` };
  const [summary, toggleToken, discountToken, runToken, voidToken] = await Promise.all([
    attempt(() => opsAdmin<ReferralSummary>(ctx.env, ctx.deps, ctx.email, 'referrals.summary')),
    ctx.token('referrals.toggle'),
    ctx.token('referrals.discount'),
    ctx.token('referrals.run'),
    ctx.token('referrals.void'),
  ]);
  if ('error' in summary)
    return { title: 'Referrals', body: html`${pageHead('Referrals')}${errorBox(summary.error)}` };
  const s = summary.ok;
  const on = s.settings.referrals_enabled === true;
  const percent =
    typeof s.settings.referral_percent === 'number' ? s.settings.referral_percent : 50;
  const hasDiscount = typeof s.settings.referral_discount_id === 'string';
  const n = (status: string) => s.by_status[status] ?? 0;

  const body = html`${pageHead(
      'Referrals',
      'Give a friend money off their first month; get a free month when they stay past 14 days (up to 12 a year).',
      html`<div class="actions">
        ${actionForm('referrals.run', runToken, html`<button class="btn">Run referrals now</button>`)}
      </div>`,
    )}
    <div class="stack">
      ${notice(ctx.notice)}
      <div class="two">
        <section class="card">
          <h2>Programme <span class="pill ${on ? 'ok' : ''}">${on ? 'On' : 'Off'}</span></h2>
          <p class="muted">
            ${on ? 'Account shows everyone their link, and referral links give the discount.' : 'Off: Account hides the section and links give no discount.'}
          </p>
          ${actionForm(
            'referrals.toggle',
            toggleToken,
            on
              ? html`<input type="hidden" name="on" value="0" /><button class="btn danger">
                    Turn off
                  </button>`
              : html`<input type="hidden" name="on" value="1" />
                  <div class="form">
                    ${audienceFields('Nobody: just turn it on', 'everyone')}
                    <div class="actions wide"><button class="btn primary">Turn on</button></div>
                  </div>`,
          )}
        </section>
        <section class="card">
          <h2>Friends' discount</h2>
          <p class="muted">
            ${hasDiscount ? `${String(percent)}% off a friend's first monthly payment.` : paddleConfigured(ctx.env) ? 'Not created yet: create it before turning the programme on.' : 'Needs PADDLE_API_KEY with Discounts write.'}
          </p>
          ${
            paddleConfigured(ctx.env)
              ? actionForm(
                  'referrals.discount',
                  discountToken,
                  html`<div class="actions">
                    <label
                      >Percent<input
                        class="narrow"
                        name="percent"
                        type="number"
                        min="1"
                        max="90"
                        value="${percent}"
                        required /></label
                    ><button class="btn">${hasDiscount ? 'Change' : 'Create discount'}</button>
                  </div>`,
                )
              : null
          }
        </section>
      </div>
      <div class="kpis">
        <div class="kpi">
          <div class="n">${s.codes}</div>
          <div class="l">Links handed out</div>
        </div>
        <div class="kpi">
          <div class="n">${n('pending')}</div>
          <div class="l">Waiting out 14 days</div>
        </div>
        <div class="kpi">
          <div class="n">${s.awaiting_paddle}</div>
          <div class="l">Due in Paddle</div>
          ${s.awaiting_paddle ? html`<div class="d">Run referrals now, or the daily job does it</div>` : null}
        </div>
        <div class="kpi">
          <div class="n">${n('rewarded')}</div>
          <div class="l">Rewarded</div>
        </div>
        <div class="kpi">
          <div class="n">${n('void') + n('capped')}</div>
          <div class="l">Void or capped</div>
        </div>
      </div>
      ${
        s.top.length
          ? html`<section class="card">
              <h2>Top referrers</h2>
              <div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Referrer</th>
                      <th class="r">Friends</th>
                      <th class="r">Months earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${s.top.map(
                      (t) =>
                        html`<tr>
                          <td>${t.email ?? '(deleted account)'}</td>
                          <td class="num">${t.joined}</td>
                          <td class="num">${t.earned}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
            </section>`
          : null
      }
      <section class="card">
        <h2>Recent referrals</h2>
        ${
          s.recent.length
            ? html`<div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Referrer</th>
                      <th>Friend</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${s.recent.map(
                      (r) =>
                        html`<tr>
                          <td class="faint">${day(r.created_at)}</td>
                          <td>${r.referrer ?? '(deleted)'}</td>
                          <td>${r.friend ?? ''}</td>
                          <td>
                            <span
                              class="pill ${r.status === 'rewarded' ? 'ok' : r.status === 'void' || r.status === 'capped' ? 'void' : 'pending'}"
                              >${r.status}</span
                            >${r.reward ? html` <span class="faint">${REWARD_LABEL[r.reward] ?? r.reward}</span>` : null}${r.note ? html`<br /><span class="faint">${r.note}</span>` : null}
                          </td>
                          <td class="r">
                            ${
                              r.status === 'pending' ||
                              (r.status === 'qualified' && r.reward !== 'paddle_month')
                                ? actionForm(
                                    'referrals.void',
                                    voidToken,
                                    html`<input type="hidden" name="id" value="${r.id}" /><input
                                        type="hidden"
                                        name="friend"
                                        value="${r.friend ?? ''}"
                                      /><button class="btn small danger">Void</button>`,
                                  )
                                : null
                            }
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<p class="faint">No referrals yet.</p>`
        }
      </section>
    </div>`;
  return { title: 'Referrals', body, counts: { referrals: s.awaiting_paddle } };
}

// ── Activity ────────────────────────────────────────────────────────────────

export async function activityPage(ctx: PageContext): Promise<Rendered> {
  if (!adminConfigured(ctx.env))
    return { title: 'Activity', body: html`${pageHead('Activity')}${ADMIN_SETUP}` };
  const list = await attempt(() =>
    opsAdmin<
      {
        at: string;
        actor: string;
        action: string;
        detail: Record<string, unknown>;
        outcome: string;
      }[]
    >(ctx.env, ctx.deps, ctx.email, 'audit.list', { limit: 100 }),
  );
  const describe = (detail: Record<string, unknown>) =>
    Object.entries(detail)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' · ');
  const body = html`${pageHead('Activity', 'Every change made here, newest first, with who made it.')}
  ${
    'error' in list
      ? errorBox(list.error)
      : list.ok.length
        ? html`<section class="card">
            <div class="scroll">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Details</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  ${list.ok.map(
                    (a) =>
                      html`<tr>
                        <td class="faint">${dayTime(a.at)}</td>
                        <td>${a.actor}</td>
                        <td>${a.action}</td>
                        <td class="muted">${describe(a.detail)}</td>
                        <td>${a.outcome}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>
          </section>`
        : html`<p class="faint">Nothing yet.</p>`
  }`;
  return { title: 'Activity', body };
}

export type { Panel };
