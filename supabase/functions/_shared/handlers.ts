import {
  checkoutSignature,
  PaddleApiError,
  PaddleClient,
  toBillingEvent,
  toRefundEvent,
  type RefundEvent,
  type IncomingBillingEvent,
  type BillingInterval,
  verifyCheckoutSignature,
  verifyPaddleSignature,
  type PaddleConfig,
} from './paddle.ts';
import { bugReportEmail, welcomeEmail } from './account-emails.ts';
import type { Email } from './launch-emails.ts';
import { SupabaseAdmin, type AuthUser, type SupabaseAdminConfig } from './supabase-admin.ts';

/**
 * Request handlers for the Edge Functions in supabase/functions/*. Each
 * index.ts only wires one of these to Deno.serve with live dependencies.
 */

export interface EmailConfig {
  resendApiKey: string;
  from: string;
  /** Where bug reports go, and where replies to account emails land. */
  support: string;
}

export interface FunctionEnv {
  /** Present when RESEND_API_KEY is set. */
  email?: EmailConfig;
  supabase: SupabaseAdminConfig;
  paddle: PaddleConfig & {
    webhookSecret: string;
    /** The Pro prices sold now (ADR-0029). */
    prices: Record<BillingInterval, string>;
    /** Older prices whose subscribers keep their price (the Pro and Advanced split). */
    legacyPrices?: readonly string[];
  };
}

export interface Deps {
  env: FunctionEnv;
  fetch: typeof fetch;
  now: () => Date;
}

// Bearer-token auth (no cookies), so any origin is safe; the extension's
// origin (chrome-extension://<id>) differs per install channel.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const PAID = new Set(['active', 'past_due', 'paused']);
/** Subscriptions that can still be changed (not paused or ended). */
const LIVE = new Set(['active', 'past_due']);

async function authenticate(req: Request, admin: SupabaseAdmin): Promise<AuthUser | Response> {
  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'unauthenticated' });
  const user = await admin.userFromToken(token);
  return user ?? json(401, { error: 'unauthenticated' });
}

/** Wraps a user-facing handler: CORS preflight, POST only, auth, error mapping. */
function userEndpoint(
  run: (ctx: {
    req: Request;
    user: AuthUser;
    admin: SupabaseAdmin;
    paddle: PaddleClient;
    env: FunctionEnv;
  }) => Promise<Response>,
) {
  return async (req: Request, deps: Deps): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const admin = new SupabaseAdmin(deps.env.supabase, deps.fetch);
    const paddle = new PaddleClient(deps.env.paddle, deps.fetch);
    try {
      const user = await authenticate(req, admin);
      if (user instanceof Response) return user;
      return await run({ req, user, admin, paddle, env: deps.env });
    } catch (error) {
      console.error('[rolestash] function failed', error);
      return json(error instanceof PaddleApiError ? 502 : 500, { error: 'server_error' });
    }
  };
}

/**
 * Parses `{ tier?, interval }`. There is one paid plan (ADR-0029); a tier of
 * 'pro' or 'advanced' from extensions before 0.4.4 means it too.
 */
function planChoice(body: { tier?: unknown; interval?: unknown }) {
  const tier = body.tier === undefined || body.tier === 'pro' || body.tier === 'advanced';
  const interval: BillingInterval | null =
    body.interval === 'year' || body.interval === 'quarter' || body.interval === 'month'
      ? body.interval
      : null;
  return tier && interval ? { interval } : null;
}

/** For webhooks: is this price ID one of ours, current or legacy? */
export function isOurPrice(env: FunctionEnv, priceId: string): boolean {
  return (
    Object.values(env.paddle.prices).includes(priceId) ||
    (env.paddle.legacyPrices ?? []).includes(priceId)
  );
}

/**
 * Paddle's formatted price, the way Canadians read it: "CA$16.99" becomes
 * "$16.99 CAD". Other currencies keep Paddle's format.
 */
export function displayPrice(formatted: string, currency: string): string {
  if (currency !== 'CAD') return formatted;
  const amount = /\d[\d,]*(?:\.\d+)?/.exec(formatted)?.[0];
  return amount ? `$${amount} CAD` : formatted;
}

/** POST /functions/v1/create-checkout  { tier, interval } → { url } */
export const handleCreateCheckout = userEndpoint(async ({ req, user, admin, paddle, env }) => {
  const choice = planChoice((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (!choice) return json(400, { error: 'invalid_plan' });

  const entitlement = await admin.entitlement(user.id);
  if (entitlement && PAID.has(entitlement.status) && entitlement.provider_subscription_id) {
    return json(409, { error: 'already_subscribed' });
  }
  // Cancelled but paid until the period ends: resume it rather than pay twice.
  if (
    entitlement?.status === 'canceled' &&
    entitlement.provider_subscription_id &&
    entitlement.current_period_end &&
    Date.parse(entitlement.current_period_end) > Date.now()
  ) {
    return json(409, { error: 'already_subscribed' });
  }
  // Returning subscribers keep their Paddle customer; everyone else is bound to
  // the customer for their account email before checkout opens.
  const customerId =
    entitlement?.provider_customer_id ??
    (user.email ? await paddle.customerForEmail(user.email) : null);
  const url = await paddle.createCheckout({
    priceId: env.paddle.prices[choice.interval],
    userId: user.id,
    signature: await checkoutSignature(env.supabase.serviceRoleKey, user.id),
    customerId,
  });
  return json(200, { url });
});

/**
 * POST /functions/v1/change-plan  { tier, interval, preview? }.
 * With `preview: true` → { preview: { action, amount, currency } }: what the
 * switch would charge or credit now, so the user confirms the amount first.
 * Without it → { changed: true }: moves a live subscription to another
 * interval (or from a legacy price to today's); Paddle prorates and charges the saved
 * payment method, the plan changes only if that payment succeeds, and the
 * webhook updates the entitlement.
 */
export const handleChangePlan = userEndpoint(async ({ req, user, admin, paddle, env }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const choice = planChoice(body);
  if (!choice) return json(400, { error: 'invalid_plan' });
  const entitlement = await admin.entitlement(user.id);
  if (!entitlement?.provider_subscription_id || !LIVE.has(entitlement.status)) {
    return json(404, { error: 'no_subscription' });
  }
  if (body.preview === true) {
    const preview = await paddle.previewChangePrice(
      entitlement.provider_subscription_id,
      env.paddle.prices[choice.interval],
    );
    return json(200, { preview });
  }
  await paddle.changePrice(
    entitlement.provider_subscription_id,
    env.paddle.prices[choice.interval],
  );
  return json(200, { changed: true });
});

/**
 * POST /functions/v1/billing-portal → { url }. Brings Paddle's customer name
 * up to date with the account's name first, so Subscription Management and
 * receipts show it (ADR-0024); a failure there never blocks the portal.
 */
export const handleBillingPortal = userEndpoint(async ({ user, admin, paddle }) => {
  const entitlement = await admin.entitlement(user.id);
  if (!entitlement?.provider_customer_id) return json(404, { error: 'no_subscription' });
  const name = (await admin.profile(user.id).catch(() => null))?.display_name?.trim();
  if (name) {
    await paddle
      .updateCustomerName(entitlement.provider_customer_id, name)
      .catch((error: unknown) => console.error('[rolestash] Paddle name update failed', error));
  }
  const url = await paddle.createPortalSession(
    entitlement.provider_customer_id,
    entitlement.provider_subscription_id,
  );
  return json(200, { url });
});

/**
 * POST /functions/v1/delete-account. Cancels a live subscription first, so
 * nobody is billed for an account that no longer exists, then deletes the user.
 */
export const handleDeleteAccount = userEndpoint(async ({ user, admin, paddle }) => {
  const entitlement = await admin.entitlement(user.id);
  if (entitlement?.provider_subscription_id && PAID.has(entitlement.status)) {
    try {
      await paddle.cancelNow(entitlement.provider_subscription_id);
    } catch (error) {
      // 4xx: already canceled or unknown to Paddle; safe to continue. 5xx: stop.
      if (!(error instanceof PaddleApiError) || error.status >= 500) throw error;
    }
  }
  await admin.deleteUser(user.id);
  return json(200, { deleted: true });
});

/**
 * POST /functions/v1/web-handoff → { tokenHash }. Lets a signed-in extension
 * sign the web board in without a second sign-in (ADR-0017): the token is
 * single-use, short-lived, and only works for this user.
 */
export const handleWebHandoff = userEndpoint(async ({ user, admin }) => {
  if (!user.email) return json(400, { error: 'no_email' });
  return json(200, { tokenHash: await admin.signInTokenFor(user.email) });
});

/** Sends one email through Resend; throws when Resend refuses it. */
async function sendEmail(
  email: EmailConfig,
  fetchFn: typeof fetch,
  message: { to: string; replyTo?: string; content: Email },
): Promise<void> {
  const response = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: email.from,
      to: [message.to],
      reply_to: message.replyTo ?? email.support,
      subject: message.content.subject,
      html: message.content.html,
      text: message.content.text,
    }),
  });
  if (!response.ok) throw new Error(`Resend failed: ${String(response.status)}`);
}

/**
 * POST /functions/v1/welcome → { sent }. The app calls it after every
 * sign-in; the email goes out once per account, ever (ADR-0024).
 */
export async function handleWelcome(req: Request, deps: Deps): Promise<Response> {
  return userEndpoint(async ({ user, admin, env }) => {
    if (!env.email) return json(503, { error: 'not_configured' });
    if (!user.email) return json(200, { sent: false });
    if (!(await admin.claimWelcome(user.id, deps.now()))) return json(200, { sent: false });
    const name = (await admin.profile(user.id))?.display_name ?? null;
    try {
      await sendEmail(env.email, deps.fetch, { to: user.email, content: welcomeEmail(name) });
    } catch (error) {
      await admin.releaseWelcome(user.id).catch(() => undefined);
      throw error;
    }
    return json(200, { sent: true });
  })(req, deps);
}

const REPORT_CONTEXT_KEYS = ['version', 'browser', 'platform', 'plan', 'where', 'page'] as const;
const REPORTS_PER_HOUR = 5;

/** The report's details, limited to known keys and short strings. */
function reportContext(value: unknown): Record<string, string> {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const key of REPORT_CONTEXT_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, key === 'page' ? 500 : 200);
  }
  return out;
}

async function hashIp(ip: string, key: string): Promise<string> {
  const hmac = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /functions/v1/bug-report { message, contactEmail?, context? } → { id }.
 * Open to everyone (the free plan has no account); a signed-in caller's
 * account is attached. At most 5 reports an hour from one address, which is
 * stored only as a keyed hash.
 */
export async function handleBugReport(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const admin = new SupabaseAdmin(deps.env.supabase, deps.fetch);
  try {
    let body: { message?: unknown; contactEmail?: unknown; context?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 5000) return json(400, { error: 'bad_message' });
    const contact =
      typeof body.contactEmail === 'string' && body.contactEmail.trim()
        ? body.contactEmail.trim()
        : null;
    if (contact && (contact.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(contact)))
      return json(400, { error: 'bad_email' });
    const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
    const user = token ? await admin.userFromToken(token) : null;
    const ip = clientIp(req);
    const ipHash = ip ? await hashIp(ip, deps.env.supabase.serviceRoleKey) : null;
    if (ipHash) {
      const hourAgo = new Date(deps.now().getTime() - 3600_000);
      if ((await admin.bugReportsSince(ipHash, hourAgo)) >= REPORTS_PER_HOUR)
        return json(429, { error: 'too_many_reports' });
    }
    const context = reportContext(body.context);
    const contactEmail = contact ?? user?.email ?? null;
    const id = await admin.insertBugReport(
      { user_id: user?.id ?? null, contact_email: contactEmail, message, context, ip_hash: ipHash },
      deps.now(),
    );
    if (deps.env.email) {
      await sendEmail(deps.env.email, deps.fetch, {
        to: deps.env.email.support,
        ...(contactEmail ? { replyTo: contactEmail } : {}),
        content: bugReportEmail({ id, message, contactEmail, signedIn: user !== null, context }),
      }).catch((error: unknown) => console.error('[rolestash] report email failed', error));
    }
    return json(200, { id });
  } catch (error) {
    console.error('[rolestash] bug report failed', error);
    return json(500, { error: 'server_error' });
  }
}

/** The caller's public IP, as the platform's proxy reports it. */
function clientIp(req: Request): string | null {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  return /^[0-9a-f:.]{3,45}$/i.test(first) ? first : null;
}

/** Recent answers by IP, so a busy board doesn't ask Paddle every time. */
const priceCache = new Map<string, { at: number; body: unknown }>();
const PRICE_CACHE_MS = 10 * 60_000;

/**
 * GET /functions/v1/prices → { currency, country, prices: { pro, advanced } }
 * with Paddle's formatted price per interval, for the caller's location
 * (ADR-0013). `advanced` repeats `pro` for extensions before 0.4.4 (ADR-0029). Public (prices are public); nothing is stored. The IP goes to
 * Paddle only to pick the currency, as Paddle.js does on the website.
 */
export async function handlePrices(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST')
    return json(405, { error: 'method_not_allowed' });
  const ip = clientIp(req);
  const key = ip ?? 'none';
  const now = deps.now().getTime();
  const cached = priceCache.get(key);
  if (cached && now - cached.at < PRICE_CACHE_MS) return json(200, cached.body);
  try {
    const ids = deps.env.paddle.prices;
    const local = await new PaddleClient(deps.env.paddle, deps.fetch).localPrices(
      [ids.month, ids.quarter, ids.year],
      ip,
    );
    const show = (id: string) => {
      const total = local.totals[id];
      return total === undefined ? undefined : displayPrice(total, local.currency);
    };
    const pro = { month: show(ids.month), quarter: show(ids.quarter), year: show(ids.year) };
    const body = {
      currency: local.currency,
      country: local.country,
      prices: { pro, advanced: pro },
    };
    if (priceCache.size > 1000) priceCache.clear();
    priceCache.set(key, { at: now, body });
    return json(200, body);
  } catch (error) {
    console.error('[rolestash] prices failed', error);
    return json(502, { error: 'prices_unavailable' });
  }
}

/**
 * The account a subscription event is for, or null to ignore it (ADR-0027).
 * custom_data comes from whoever opened the checkout, so a user id counts only
 * when the subscription is already that account's, or when create-checkout
 * signed it for that account and the customer has the account's email (the
 * customer create-checkout bound the checkout to). Purchases are never matched
 * to an account by the email typed at checkout.
 */
async function accountForEvent(
  admin: SupabaseAdmin,
  paddle: PaddleClient,
  secret: string,
  event: IncomingBillingEvent,
): Promise<string | null> {
  const { userId, customerId } = event;
  if (!userId || !customerId) return null;
  const entitlement = await admin.entitlement(userId);
  if (
    entitlement?.provider_subscription_id === event.subscriptionId &&
    entitlement.provider_customer_id === customerId
  )
    return userId;
  if (!(await verifyCheckoutSignature(secret, userId, event.checkoutSignature))) return null;
  if (entitlement?.provider_customer_id === customerId) return userId;
  const accountEmail = await admin.userEmail(userId);
  if (!accountEmail) return null;
  const customerEmail = await paddle.customerEmail(customerId);
  const normalise = (email: string) => email.trim().toLowerCase();
  return customerEmail !== null && normalise(customerEmail) === normalise(accountEmail)
    ? userId
    : null;
}

/**
 * A full refund or chargeback of the payment for the current period moves the
 * account to Free, as the refund policy says: cancel the subscription now, and
 * Paddle's subscription.canceled event updates the entitlement as usual. A
 * refund of an earlier period's payment keeps the plan that's paid for now.
 */
async function endRefundedSubscription(paddle: PaddleClient, refund: RefundEvent) {
  const subscription = await paddle.subscriptionPeriod(refund.subscriptionId);
  if (subscription.status === 'canceled') return json(200, { ignored: true });
  const paidFrom = await paddle.transactionPeriodStart(refund.transactionId);
  if (
    !paidFrom ||
    !subscription.startsAt ||
    Date.parse(paidFrom) !== Date.parse(subscription.startsAt)
  ) {
    console.error('[rolestash] webhook: refund is not for the current period; plan kept', {
      adjustmentId: refund.adjustmentId,
      subscriptionId: refund.subscriptionId,
    });
    return json(200, { ignored: true });
  }
  try {
    await paddle.cancelNow(refund.subscriptionId);
  } catch (error) {
    // 4xx: already canceled; 5xx: let Paddle retry.
    if (!(error instanceof PaddleApiError) || error.status >= 500) throw error;
  }
  return json(200, { canceled: true });
}

/** POST /functions/v1/paddle-webhook (called by Paddle, signed; no user JWT). */
export async function handlePaddleWebhook(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const raw = await req.text();
  const signed = await verifyPaddleSignature(
    raw,
    req.headers.get('Paddle-Signature'),
    deps.env.paddle.webhookSecret,
    deps.now(),
  );
  if (!signed) return json(401, { error: 'bad_signature' });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'bad_json' });
  }
  const paddle = new PaddleClient(deps.env.paddle, deps.fetch);
  const refund = toRefundEvent(payload);
  if (refund) {
    try {
      return await endRefundedSubscription(paddle, refund);
    } catch (error) {
      console.error('[rolestash] webhook refund failed', error);
      return json(500, { error: 'server_error' });
    }
  }
  const incoming = toBillingEvent(payload, (priceId) => isOurPrice(deps.env, priceId));
  if (!incoming) return json(200, { ignored: true });
  const admin = new SupabaseAdmin(deps.env.supabase, deps.fetch);
  try {
    const userId = await accountForEvent(admin, paddle, deps.env.supabase.serviceRoleKey, incoming);
    if (!userId) {
      // Not from a checkout we made for a signed-in account: applying it could
      // overwrite someone's subscription. A real buyer here is refunded by hand.
      console.error('[rolestash] webhook: subscription has no verified account', {
        subscriptionId: incoming.subscriptionId,
        customerId: incoming.customerId,
      });
      return json(200, { ignored: true });
    }
    const applied = await admin.applyBillingEvent({ ...incoming, userId }, 'paddle');
    return json(200, { applied });
  } catch (error) {
    // Non-2xx makes Paddle retry later.
    console.error('[rolestash] webhook failed', error);
    return json(500, { error: 'server_error' });
  }
}
