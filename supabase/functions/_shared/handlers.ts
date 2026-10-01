import {
  PaddleApiError,
  PaddleClient,
  toBillingEvent,
  type BillingInterval,
  type PaidTier,
  verifyPaddleSignature,
  type PaddleConfig,
} from './paddle.ts';
import { SupabaseAdmin, type AuthUser, type SupabaseAdminConfig } from './supabase-admin.ts';

/**
 * Request handlers for the Edge Functions in supabase/functions/*. Each
 * index.ts only wires one of these to Deno.serve with live dependencies.
 */

export interface FunctionEnv {
  supabase: SupabaseAdminConfig;
  paddle: PaddleConfig & {
    webhookSecret: string;
    prices: Record<PaidTier, Record<BillingInterval, string>>;
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/** Parses `{ tier?, interval }`; tier defaults to Pro for older clients. */
function planChoice(body: { tier?: unknown; interval?: unknown }) {
  const tier: PaidTier | null =
    body.tier === undefined || body.tier === 'pro'
      ? 'pro'
      : body.tier === 'advanced'
        ? 'advanced'
        : null;
  const interval: BillingInterval | null =
    body.interval === 'year' ? 'year' : body.interval === 'month' ? 'month' : null;
  return tier && interval ? { tier, interval } : null;
}

/** Reverse lookup for webhooks: which tier a price ID belongs to. */
export function tierOfPrice(env: FunctionEnv, priceId: string): PaidTier | undefined {
  for (const tier of ['pro', 'advanced'] as const)
    if (Object.values(env.paddle.prices[tier]).includes(priceId)) return tier;
  return undefined;
}

/** POST /functions/v1/create-checkout  { tier, interval } → { url } */
export const handleCreateCheckout = userEndpoint(async ({ req, user, admin, paddle, env }) => {
  const choice = planChoice((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (!choice) return json(400, { error: 'invalid_plan' });

  const entitlement = await admin.entitlement(user.id);
  if (entitlement && PAID.has(entitlement.status) && entitlement.provider_subscription_id) {
    return json(409, { error: 'already_subscribed' });
  }
  // Returning subscribers keep their Paddle customer; everyone else is bound to
  // the customer for their account email before checkout opens.
  const customerId =
    entitlement?.provider_customer_id ??
    (user.email ? await paddle.customerForEmail(user.email) : null);
  const url = await paddle.createCheckout({
    priceId: env.paddle.prices[choice.tier][choice.interval],
    userId: user.id,
    customerId,
  });
  return json(200, { url });
});

/**
 * POST /functions/v1/change-plan  { tier, interval } → { changed: true }.
 * Moves a live subscription between Pro and Advanced (or monthly and yearly);
 * Paddle prorates, and the webhook updates the entitlement.
 */
export const handleChangePlan = userEndpoint(async ({ req, user, admin, paddle, env }) => {
  const choice = planChoice((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (!choice) return json(400, { error: 'invalid_plan' });
  const entitlement = await admin.entitlement(user.id);
  if (!entitlement?.provider_subscription_id || !LIVE.has(entitlement.status)) {
    return json(404, { error: 'no_subscription' });
  }
  await paddle.changePrice(
    entitlement.provider_subscription_id,
    env.paddle.prices[choice.tier][choice.interval],
  );
  return json(200, { changed: true });
});

/** POST /functions/v1/billing-portal → { url } */
export const handleBillingPortal = userEndpoint(async ({ user, admin, paddle }) => {
  const entitlement = await admin.entitlement(user.id);
  if (!entitlement?.provider_customer_id) return json(404, { error: 'no_subscription' });
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
  const event = toBillingEvent(payload, (priceId) => tierOfPrice(deps.env, priceId));
  if (!event) return json(200, { ignored: true });
  try {
    const applied = await new SupabaseAdmin(deps.env.supabase, deps.fetch).applyBillingEvent(
      event,
      'paddle',
    );
    return json(200, { applied });
  } catch (error) {
    // Non-2xx makes Paddle retry later.
    console.error('[rolestash] webhook failed', error);
    return json(500, { error: 'server_error' });
  }
}
