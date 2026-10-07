import {
  handleBillingPortal,
  handleChangePlan,
  handleCreateCheckout,
  handleDeleteAccount,
  handlePaddleWebhook,
  handlePrices,
  handleWebHandoff,
  isOurPrice,
  displayPrice,
  type Deps,
} from '../../../supabase/functions/_shared/handlers.ts';
import { readEnv } from '../../../supabase/functions/_shared/env.ts';
import { checkoutSignature } from '../../../supabase/functions/_shared/paddle.ts';
import { fakeFetch, type FakeResponse, type RecordedCall } from '../helpers/fake-fetch';
import { subscriptionEvent } from './fixtures';

const SB = 'https://ref.supabase.co';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' };
const NOW = new Date('2026-10-01T00:00:00.000Z');

const ENV = readEnv(
  (name) =>
    ({
      SUPABASE_URL: SB,
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      PADDLE_ENV: 'sandbox',
      PADDLE_API_KEY: 'pdl_key',
      PADDLE_WEBHOOK_SECRET: 'whsec',
      PADDLE_PRICE_PRO_MONTHLY: 'pri_pro_month',
      PADDLE_PRICE_PRO_QUARTERLY: 'pri_pro_quarter',
      PADDLE_PRICE_PRO_YEARLY: 'pri_pro_year',
      PADDLE_LEGACY_PRICES: 'pri_adv_month, pri_adv_quarter,pri_adv_year',
    })[name],
);

function deps(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch({
    [`GET ${SB}/auth/v1/user`]: (call) =>
      call.headers.Authorization === 'Bearer good-token'
        ? { status: 200, body: USER }
        : { status: 401, body: {} },
    ...routes,
  });
  const d: Deps = { env: ENV, fetch: f.fetch, now: () => NOW };
  return { deps: d, calls: f.calls };
}

const entitlementRoute = (row: Record<string, unknown> | null): FakeResponse => ({
  status: 200,
  body: row ? [row] : [],
});

const post = (body?: unknown, token = 'good-token') =>
  new Request('https://fn', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('user endpoints', () => {
  it('answers CORS preflight and rejects other methods and bad tokens', async () => {
    const { deps: d } = deps({});
    const pre = await handleCreateCheckout(new Request('https://fn', { method: 'OPTIONS' }), d);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect((await handleCreateCheckout(new Request('https://fn'), d)).status).toBe(405);
    expect((await handleCreateCheckout(post({ interval: 'month' }, 'bad'), d)).status).toBe(401);
    const noAuth = new Request('https://fn', { method: 'POST' });
    expect((await handleBillingPortal(noAuth, d)).status).toBe(401);
  });

  it('refuses a session without the second step once two-step sign-in is on (ADR-0036)', async () => {
    const jwt = (aal: string) => `h.${btoa(JSON.stringify({ aal }))}.s`;
    const { deps: d } = deps({
      [`GET ${SB}/auth/v1/user`]: () => ({
        status: 200,
        body: { ...USER, factors: [{ status: 'verified', factor_type: 'totp' }] },
      }),
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute(null),
    });
    expect((await handleDeleteAccount(post({}, jwt('aal1')), d)).status).toBe(401);
    // With the second step it goes on to the endpoint's own checks.
    expect((await handleBillingPortal(post({}, jwt('aal2')), d)).status).toBe(404);
  });

  it('create-checkout returns a Paddle checkout URL for the chosen interval', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ status: 'trialing' }),
      'GET https://sandbox-api.paddle.com/customers': { status: 200, body: { data: [] } },
      'POST https://sandbox-api.paddle.com/customers': {
        status: 201,
        body: { data: { id: 'ctm_new' } },
      },
      'POST https://sandbox-api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_1' } } },
      },
    });
    const res = await handleCreateCheckout(post({ interval: 'year' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://rolestash.com/pay/?_ptxn=txn_1' });
    // The Paddle customer is looked up, then created, for the account's email.
    const customerLookup = calls.find((c) => c.method === 'GET' && c.url.includes('/customers'));
    expect(customerLookup?.url).toContain(`email=${encodeURIComponent(USER.email)}`);
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/customers'))?.body).toEqual({
      email: USER.email,
    });
    const paddleCall = calls.find((c) => c.url.endsWith('/transactions'));
    expect(paddleCall?.body).toMatchObject({
      items: [{ price_id: 'pri_pro_year' }],
      // Signed, so the webhook knows this checkout is for this signed-in account.
      custom_data: {
        user_id: USER.id,
        checkout_sig: await checkoutSignature('service', USER.id),
      },
      customer_id: 'ctm_new',
    });
    // The entitlement lookup uses the service role, scoped to this user.
    const lookup = calls.find((c) => c.url.includes('/rest/v1/entitlements'));
    expect(lookup?.url).toContain(`user_id=eq.${USER.id}`);
    expect(lookup?.headers.apikey).toBe('service');
  });

  it('create-checkout reuses the Paddle customer for the account email', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ status: 'expired' }),
      'GET https://sandbox-api.paddle.com/customers': {
        status: 200,
        body: { data: [{ id: 'ctm_existing' }] },
      },
      'POST https://sandbox-api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_2' } } },
      },
    });
    expect((await handleCreateCheckout(post({ interval: 'month' }), d)).status).toBe(200);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/customers'))).toBe(false);
    expect(calls.find((c) => c.url.endsWith('/transactions'))?.body).toMatchObject({
      customer_id: 'ctm_existing',
    });
  });

  it('create-checkout keeps a returning subscriber on their Paddle customer', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'canceled',
        provider_customer_id: 'ctm_returning',
      }),
      'POST https://sandbox-api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_3' } } },
      },
    });
    expect((await handleCreateCheckout(post({ interval: 'month' }), d)).status).toBe(200);
    expect(calls.some((c) => c.url.includes('/customers'))).toBe(false);
    expect(calls.find((c) => c.url.endsWith('/transactions'))?.body).toMatchObject({
      customer_id: 'ctm_returning',
    });
  });

  it('create-checkout rejects bad intervals and existing subscribers', async () => {
    const { deps: d } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_subscription_id: 'sub_01',
      }),
    });
    expect((await handleCreateCheckout(post({ interval: 'week' }), d)).status).toBe(400);
    expect(
      (await handleCreateCheckout(post({ tier: 'platinum', interval: 'month' }), d)).status,
    ).toBe(400);
    const res = await handleCreateCheckout(post({ interval: 'month' }), d);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_subscribed' });
  });

  it('maps Paddle outages to 502 and our own failures to 500', async () => {
    const paddleDown = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute(null),
      'GET https://sandbox-api.paddle.com/customers': { status: 503, body: {} },
      'POST https://sandbox-api.paddle.com/transactions': { status: 503, body: {} },
    });
    expect((await handleCreateCheckout(post({ interval: 'month' }), paddleDown.deps)).status).toBe(
      502,
    );
    const dbDown = deps({ [`GET ${SB}/rest/v1/entitlements`]: { status: 500, body: {} } });
    expect((await handleBillingPortal(post(), dbDown.deps)).status).toBe(500);
  });

  it('billing-portal needs a Paddle customer', async () => {
    const none = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ status: 'trialing' }),
    });
    expect((await handleBillingPortal(post(), none.deps)).status).toBe(404);

    const paying = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_customer_id: 'ctm_01',
        provider_subscription_id: 'sub_01',
      }),
      'POST https://sandbox-api.paddle.com/customers/ctm_01/portal-sessions': {
        status: 201,
        body: { data: { urls: { general: { overview: 'https://portal' } } } },
      },
    });
    const res = await handleBillingPortal(post(), paying.deps);
    expect(await res.json()).toEqual({ url: 'https://portal' });
  });

  it('delete-account cancels a live subscription first, then deletes the user', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_subscription_id: 'sub_01',
      }),
      'POST https://sandbox-api.paddle.com/subscriptions/sub_01/cancel': {
        status: 200,
        body: { data: {} },
      },
      [`DELETE ${SB}/auth/v1/admin/users/${USER.id}`]: { status: 200, body: {} },
    });
    const res = await handleDeleteAccount(post(), d);
    expect(res.status).toBe(200);
    const order = calls.map((c) => `${c.method} ${c.url.split('?')[0] ?? ''}`);
    expect(
      order.indexOf('POST https://sandbox-api.paddle.com/subscriptions/sub_01/cancel'),
    ).toBeLessThan(order.indexOf(`DELETE ${SB}/auth/v1/admin/users/${USER.id}`));
    expect(calls.find((c) => c.url.endsWith('/cancel'))?.body).toEqual({
      effective_from: 'immediately',
    });
  });

  it('delete-account continues if Paddle already canceled, but stops if Paddle is down', async () => {
    const base = {
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'past_due',
        provider_subscription_id: 'sub_01',
      }),
      [`DELETE ${SB}/auth/v1/admin/users/${USER.id}`]: { status: 200, body: {} },
    };
    const gone = deps({
      ...base,
      'POST https://sandbox-api.paddle.com/subscriptions/sub_01/cancel': { status: 422, body: {} },
    });
    expect((await handleDeleteAccount(post(), gone.deps)).status).toBe(200);

    const down = deps({
      ...base,
      'POST https://sandbox-api.paddle.com/subscriptions/sub_01/cancel': { status: 500, body: {} },
    });
    expect((await handleDeleteAccount(post(), down.deps)).status).toBe(502);
    expect(down.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('delete-account works without any subscription', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ status: 'trialing' }),
      [`DELETE ${SB}/auth/v1/admin/users/${USER.id}`]: { status: 404, body: {} },
    });
    expect((await handleDeleteAccount(post(), d)).status).toBe(200);
    expect(calls.some((c) => c.url.includes('paddle'))).toBe(false);
  });
});

describe('codes at checkout (ADR-0035)', () => {
  const PADDLE = 'https://sandbox-api.paddle.com';
  const base = (routes: Parameters<typeof fakeFetch>[0]) =>
    deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ status: 'trialing' }),
      [`GET ${PADDLE}/customers`]: { status: 200, body: { data: [{ id: 'ctm_1' }] } },
      [`POST ${PADDLE}/transactions`]: {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_1' } } },
      },
      [`GET ${PADDLE}/prices/pri_pro_month`]: {
        status: 200,
        body: { data: { product_id: 'pro_1' } },
      },
      [`GET ${PADDLE}/prices/pri_pro_year`]: {
        status: 200,
        body: { data: { product_id: 'pro_1' } },
      },
      ...routes,
    });
  const unknown: FakeResponse = { status: 200, body: { kind: 'unknown' } };
  const referral = (extra: Record<string, unknown> = {}): FakeResponse => ({
    status: 200,
    body: {
      kind: 'referral',
      eligible: true,
      code: 'K7Q2M9XA',
      percent: 50,
      discount_id: 'dsc_ref',
      ...extra,
    },
  });
  const discount = (extra: Record<string, unknown> = {}) => ({
    id: 'dsc_launch',
    code: 'LAUNCH30',
    status: 'active',
    type: 'percentage',
    amount: '30',
    restrict_to: ['pri_pro_month', 'pri_pro_year'],
    expires_at: '2026-12-31T00:00:00Z',
    usage_limit: 200,
    times_used: 3,
    ...extra,
  });
  const transaction = (calls: RecordedCall[]) =>
    calls.find((c) => c.method === 'POST' && c.url.endsWith('/transactions'))?.body as Record<
      string,
      unknown
    >;

  it('applies a Paddle discount code that fits the price', async () => {
    const { deps: d, calls } = base({
      [`POST ${SB}/rest/v1/rpc/checkout_code`]: unknown,
      [`GET ${PADDLE}/discounts`]: { status: 200, body: { data: [discount()] } },
    });
    const res = await handleCreateCheckout(post({ interval: 'year', code: 'launch30' }), d);
    expect(await res.json()).toEqual({
      url: 'https://rolestash.com/pay/?_ptxn=txn_1',
      discount: { kind: 'code', code: 'LAUNCH30', percent: 30 },
    });
    expect(transaction(calls)).toMatchObject({ discount_id: 'dsc_launch' });
    expect(calls.find((c) => c.url.includes('/discounts'))?.url).toContain('code=launch30');
  });

  it('refuses codes that are expired, used up, for another price, or unknown', async () => {
    for (const found of [
      [discount({ expires_at: '2026-09-01T00:00:00Z' })],
      [discount({ usage_limit: 3 })],
      [discount({ restrict_to: ['pri_other'] })],
      [],
    ]) {
      const { deps: d, calls } = base({
        [`POST ${SB}/rest/v1/rpc/checkout_code`]: unknown,
        [`GET ${PADDLE}/discounts`]: { status: 200, body: { data: found } },
      });
      const res = await handleCreateCheckout(post({ interval: 'year', code: 'LAUNCH30' }), d);
      expect(res.status, JSON.stringify(found)).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_code' });
      expect(transaction(calls)).toBeUndefined();
    }
    const { deps: d } = base({});
    expect(
      (await handleCreateCheckout(post({ interval: 'year', code: '<script>' }), d)).status,
    ).toBe(400);
  });

  it('gives a referred friend the referral discount on monthly, and credits the referrer', async () => {
    const { deps: d, calls } = base({ [`POST ${SB}/rest/v1/rpc/checkout_code`]: referral() });
    const res = await handleCreateCheckout(post({ interval: 'month', ref: 'K7Q2M9XA' }), d);
    expect(await res.json()).toMatchObject({
      discount: { kind: 'referral', code: 'K7Q2M9XA', percent: 50 },
    });
    expect(transaction(calls)).toMatchObject({
      discount_id: 'dsc_ref',
      custom_data: { user_id: USER.id, ref: 'K7Q2M9XA' },
    });
  });

  it('on yearly, still credits the referrer but gives no referral discount', async () => {
    const { deps: d, calls } = base({ [`POST ${SB}/rest/v1/rpc/checkout_code`]: referral() });
    const res = await handleCreateCheckout(post({ interval: 'year', ref: 'K7Q2M9XA' }), d);
    expect(await res.json()).toEqual({
      url: 'https://rolestash.com/pay/?_ptxn=txn_1',
      note: 'referral_monthly_only',
    });
    expect(transaction(calls)).not.toHaveProperty('discount_id');
    expect(transaction(calls)).toMatchObject({ custom_data: { ref: 'K7Q2M9XA' } });
  });

  it('with a referral and a code, applies the bigger discount and keeps the referral', async () => {
    const { deps: d, calls } = base({
      [`POST ${SB}/rest/v1/rpc/checkout_code`]: (call) =>
        (call.body as { p_code: string }).p_code === 'K7Q2M9XA' ? referral() : unknown,
      [`GET ${PADDLE}/discounts`]: { status: 200, body: { data: [discount()] } },
    });
    await handleCreateCheckout(post({ interval: 'month', ref: 'K7Q2M9XA', code: 'LAUNCH30' }), d);
    expect(transaction(calls)).toMatchObject({
      discount_id: 'dsc_ref',
      custom_data: { ref: 'K7Q2M9XA' },
    });
  });

  it("says why a typed referral code can't be used, and ignores a stale referral link", async () => {
    const own = base({
      [`POST ${SB}/rest/v1/rpc/checkout_code`]: referral({ eligible: false, reason: 'own_code' }),
    });
    const res = await handleCreateCheckout(post({ interval: 'month', code: 'K7Q2M9XA' }), own.deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'code_not_usable', reason: 'own_code' });

    const stale = base({
      [`POST ${SB}/rest/v1/rpc/checkout_code`]: referral({
        eligible: false,
        reason: 'not_first_purchase',
      }),
    });
    const ok = await handleCreateCheckout(post({ interval: 'month', ref: 'K7Q2M9XA' }), stale.deps);
    expect(await ok.json()).toEqual({
      url: 'https://rolestash.com/pay/?_ptxn=txn_1',
      note: 'not_first_purchase',
    });
    expect(transaction(stale.calls)).not.toHaveProperty('discount_id');
  });

  it('stops anyone trying many codes', async () => {
    const { deps: d } = base({
      [`POST ${SB}/rest/v1/rpc/checkout_code`]: { status: 200, body: { kind: 'rate_limited' } },
    });
    const res = await handleCreateCheckout(post({ interval: 'month', code: 'GUESS123' }), d);
    expect(res.status).toBe(429);
  });
});

describe('plan choice and change-plan', () => {
  it('create-checkout uses the Pro price for the chosen interval, whatever the tier', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'expired',
        provider_customer_id: 'ctm_1',
      }),
      'POST https://sandbox-api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_a' } } },
      },
    });
    expect(
      (await handleCreateCheckout(post({ tier: 'advanced', interval: 'year' }), d)).status,
    ).toBe(200);
    expect((await handleCreateCheckout(post({ tier: 'pro', interval: 'quarter' }), d)).status).toBe(
      200,
    );
    expect(calls.filter((c) => c.url.endsWith('/transactions')).at(-1)?.body).toMatchObject({
      items: [{ price_id: 'pri_pro_quarter' }],
    });
    // Extensions before 0.4.4 still send 'advanced'; it buys today's Pro (ADR-0029).
    expect(calls.find((c) => c.url.endsWith('/transactions'))?.body).toMatchObject({
      items: [{ price_id: 'pri_pro_year' }],
    });
    expect((await handleCreateCheckout(post({ tier: 'team', interval: 'year' }), d)).status).toBe(
      400,
    );
  });

  it('create-checkout refuses a second subscription while a cancelled one still runs', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'canceled',
        provider_subscription_id: 'sub_01',
        current_period_end: '2999-01-01T00:00:00Z',
      }),
    });
    const res = await handleCreateCheckout(post({ tier: 'pro', interval: 'month' }), d);
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.url.includes('paddle'))).toBe(false);
  });

  it('change-plan moves a live subscription to the new price with proration', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_subscription_id: 'sub_01',
      }),
      'PATCH https://sandbox-api.paddle.com/subscriptions/sub_01': {
        status: 200,
        body: { data: {} },
      },
    });
    const res = await handleChangePlan(post({ tier: 'pro', interval: 'month' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      items: [{ price_id: 'pri_pro_month', quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
      on_payment_failure: 'prevent_change',
    });
  });

  it('change-plan previews the amount due now without changing anything', async () => {
    const { deps: d, calls } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_subscription_id: 'sub_01',
      }),
      'PATCH https://sandbox-api.paddle.com/subscriptions/sub_01/preview': {
        status: 200,
        body: {
          data: {
            update_summary: {
              credit: { amount: '-662', currency_code: 'USD' },
              charge: { amount: '1510', currency_code: 'USD' },
              result: { action: 'charge', amount: '1298', currency_code: 'AUD' },
            },
            recurring_transaction_details: { totals: { total: '2299', currency_code: 'AUD' } },
            next_billed_at: '2026-11-02T12:43:31Z',
          },
        },
      },
    });
    const res = await handleChangePlan(post({ tier: 'pro', interval: 'month', preview: true }), d);
    expect(await res.json()).toEqual({
      // In the customer's own currency, now and from the next bill.
      preview: {
        action: 'charge',
        amount: 1298,
        currency: 'AUD',
        recurring: 2299,
        nextBilledAt: '2026-11-02T12:43:31Z',
      },
    });
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.url)).toEqual([
      'https://sandbox-api.paddle.com/subscriptions/sub_01/preview',
    ]);
  });

  it('a downgrade previews as a credit', async () => {
    const { deps: d } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_subscription_id: 'sub_01',
      }),
      'PATCH https://sandbox-api.paddle.com/subscriptions/sub_01/preview': {
        status: 200,
        body: {
          data: {
            update_summary: { result: { action: 'credit', amount: '-700', currency_code: 'GBP' } },
          },
        },
      },
    });
    const res = await handleChangePlan(post({ tier: 'pro', interval: 'month', preview: true }), d);
    expect(await res.json()).toEqual({
      preview: { action: 'credit', amount: 700, currency: 'GBP' },
    });
  });

  it('change-plan needs a live subscription and a valid plan', async () => {
    for (const row of [
      null,
      { status: 'trialing' },
      { status: 'paused', provider_subscription_id: 'sub_01' },
    ]) {
      const { deps: d } = deps({ [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute(row) });
      expect((await handleChangePlan(post({ tier: 'pro', interval: 'month' }), d)).status).toBe(
        404,
      );
    }
    const { deps: d } = deps({});
    expect((await handleChangePlan(post({ tier: 'pro' }), d)).status).toBe(400);
  });

  it('knows our current and legacy prices', () => {
    expect(isOurPrice(ENV, 'pri_pro_month')).toBe(true);
    expect(isOurPrice(ENV, 'pri_adv_year')).toBe(true);
    expect(isOurPrice(ENV, 'pri_unknown')).toBe(false);
  });

  it('shows Canadian prices as "$16.99 CAD"', () => {
    expect(displayPrice('CA$16.99', 'CAD')).toBe('$16.99 CAD');
    expect(displayPrice('$1,299.00', 'CAD')).toBe('$1,299.00 CAD');
    expect(displayPrice('A$17.99', 'AUD')).toBe('A$17.99');
    expect(displayPrice('£9.99', 'GBP')).toBe('£9.99');
  });
});

describe('paddle-webhook', () => {
  async function signedRequest(payload: unknown, secret = 'whsec') {
    const body = JSON.stringify(payload);
    const ts = String(NOW.getTime() / 1000);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`));
    const h1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return new Request('https://fn', {
      method: 'POST',
      headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` },
      body,
    });
  }

  // The event's subscription and customer are already the account's own.
  const ownCustomer = {
    [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
      provider_customer_id: 'ctm_01',
      provider_subscription_id: 'sub_01',
    }),
  };
  const applyCall = (calls: RecordedCall[]) =>
    calls.find((c) => c.url.includes('apply_billing_event'));

  it('applies a verified subscription event via apply_billing_event', async () => {
    const { deps: d, calls } = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const res = await handlePaddleWebhook(await signedRequest(subscriptionEvent()), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    expect(applyCall(calls)?.body).toEqual({
      p_user_id: USER.id,
      p_occurred_at: '2026-10-01T00:00:00.000Z',
      p_status: 'active',
      p_current_period_end: '2026-11-01T00:00:00Z',
      p_billing_interval: 'month',
      p_provider: 'paddle',
      p_customer_id: 'ctm_01',
      p_subscription_id: 'sub_01',
      p_tier: 'advanced',
    });
    expect(applyCall(calls)?.headers.apikey).toBe('service');
  });

  describe('a new subscription (ADR-0027: buyers can set any custom_data)', () => {
    const signed = async (userId = USER.id) =>
      subscriptionEvent({
        custom_data: { user_id: userId, checkout_sig: await checkoutSignature('service', userId) },
      });
    const noCustomerYet = {
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ provider_customer_id: null }),
    };
    const account = (email: string | null): Record<string, FakeResponse> => ({
      [`GET ${SB}/auth/v1/admin/users/${USER.id}`]: email
        ? { status: 200, body: { id: USER.id, email } }
        : { status: 404, body: {} },
    });
    const customerWith = (email: string): Record<string, FakeResponse> => ({
      'GET https://sandbox-api.paddle.com/customers/ctm_01': {
        status: 200,
        body: { data: { email } },
      },
    });
    const apply = { [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true } };

    it('applies a checkout create-checkout signed, for the customer with the account email', async () => {
      const { deps: d, calls } = deps({
        ...noCustomerYet,
        ...account(USER.email),
        ...customerWith('A@Example.com'),
        ...apply,
      });
      const res = await handlePaddleWebhook(await signedRequest(await signed()), d);
      expect(await res.json()).toEqual({ applied: true });
      expect(applyCall(calls)?.body).toMatchObject({
        p_user_id: USER.id,
        p_customer_id: 'ctm_01',
      });
    });

    it('applies a signed checkout for the customer already on the account', async () => {
      const { deps: d, calls } = deps({
        [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
          provider_customer_id: 'ctm_01',
          provider_subscription_id: 'sub_old',
        }),
        ...apply,
      });
      const res = await handlePaddleWebhook(await signedRequest(await signed()), d);
      expect(await res.json()).toEqual({ applied: true });
      expect(applyCall(calls)?.body).toMatchObject({ p_subscription_id: 'sub_01' });
    });

    it('ignores an unsigned or forged claim, even with the account email or customer', async () => {
      const forged = async (custom_data: unknown) => {
        const { deps: d, calls } = deps({
          [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
            provider_customer_id: 'ctm_01',
            provider_subscription_id: 'sub_live',
            status: 'active',
          }),
          ...account(USER.email),
          ...customerWith(USER.email),
          ...apply,
        });
        const res = await handlePaddleWebhook(
          await signedRequest(subscriptionEvent({ custom_data })),
          d,
        );
        expect(await res.json()).toEqual({ ignored: true });
        expect(applyCall(calls)).toBeUndefined();
      };
      // Paddle.js on any page can name someone's account in custom_data.
      await forged({ user_id: USER.id });
      await forged({ user_id: USER.id, checkout_sig: 'f'.repeat(64) });
      await forged({
        user_id: USER.id,
        checkout_sig: await checkoutSignature('service', '22222222-2222-4222-8222-222222222222'),
      });
      await forged({ user_id: USER.id, checkout_sig: await checkoutSignature('other', USER.id) });
    });

    it("ignores a signed claim when the customer is someone else's", async () => {
      const { deps: d, calls } = deps({
        [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({ provider_customer_id: 'ctm_mine' }),
        ...account(USER.email),
        ...customerWith('victim@example.com'),
      });
      const res = await handlePaddleWebhook(await signedRequest(await signed()), d);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
      expect(applyCall(calls)).toBeUndefined();
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
    });

    it('ignores it for an unknown account, or an event without a customer', async () => {
      const unknown = deps({ ...noCustomerYet, ...account(null) });
      const res = await handlePaddleWebhook(await signedRequest(await signed()), unknown.deps);
      expect(await res.json()).toEqual({ ignored: true });
      expect(applyCall(unknown.calls)).toBeUndefined();

      const noCustomer = deps({});
      const bare = await signedRequest({
        ...(await signed()),
        data: { ...(await signed()).data, customer_id: null },
      });
      expect(await (await handlePaddleWebhook(bare, noCustomer.deps)).json()).toEqual({
        ignored: true,
      });
      expect(noCustomer.calls).toHaveLength(0);
    });

    it('asks Paddle to retry when the check fails', async () => {
      const { deps: d } = deps({
        ...noCustomerYet,
        ...account(USER.email),
        'GET https://sandbox-api.paddle.com/customers/ctm_01': { status: 503, body: {} },
      });
      const res = await handlePaddleWebhook(await signedRequest(await signed()), d);
      expect(res.status).toBe(500);

      const down = deps({ [`GET ${SB}/rest/v1/entitlements`]: { status: 503, body: {} } });
      expect(
        (await handlePaddleWebhook(await signedRequest(await signed()), down.deps)).status,
      ).toBe(500);
    });
  });

  it('records a purchase through a referral link before applying it (ADR-0035)', async () => {
    const { deps: d, calls } = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/record_referral`]: { status: 200, body: 'recorded' },
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const event = subscriptionEvent({
      transaction_id: 'txn_9',
      custom_data: { user_id: USER.id, ref: 'K7Q2M9XA' },
    });
    const res = await handlePaddleWebhook(await signedRequest(event), d);
    expect(await res.json()).toEqual({ applied: true });
    const rpcs = calls.filter((c) => c.url.includes('/rpc/')).map((c) => c.url.split('/rpc/')[1]);
    expect(rpcs).toEqual(['record_referral', 'apply_billing_event']);
    expect(calls.find((c) => c.url.endsWith('/rpc/record_referral'))?.body).toEqual({
      p_code: 'K7Q2M9XA',
      p_friend: USER.id,
      p_transaction_id: 'txn_9',
      p_subscription_id: 'sub_01',
      p_customer_id: 'ctm_01',
    });
  });

  it('still applies the plan if recording a referral fails, and ignores malformed codes', async () => {
    const failing = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/record_referral`]: { status: 500, body: {} },
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const event = subscriptionEvent({ custom_data: { user_id: USER.id, ref: 'K7Q2M9XA' } });
    expect(
      await (await handlePaddleWebhook(await signedRequest(event), failing.deps)).json(),
    ).toEqual({
      applied: true,
    });
    const odd = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const forged = subscriptionEvent({ custom_data: { user_id: USER.id, ref: "x' or 1=1" } });
    await handlePaddleWebhook(await signedRequest(forged), odd.deps);
    expect(odd.calls.some((c) => c.url.endsWith('/rpc/record_referral'))).toBe(false);
  });

  it('never matches a purchase without an account to one by its checkout email', async () => {
    // A Paddle.js checkout with no custom_data, e.g. someone else's email typed in.
    const { deps: d, calls } = deps({});
    const res = await handlePaddleWebhook(
      await signedRequest(subscriptionEvent({ custom_data: null })),
      d,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(calls).toHaveLength(0);
  });

  describe('refunds (the refund policy: a refund moves you to Free)', () => {
    const adjustment = (data: Record<string, unknown> = {}, event_type = 'adjustment.updated') => ({
      event_type,
      occurred_at: '2026-10-01T00:00:00.000Z',
      data: {
        id: 'adj_01',
        action: 'refund',
        type: 'full',
        status: 'approved',
        transaction_id: 'txn_01',
        subscription_id: 'sub_01',
        customer_id: 'ctm_01',
        ...data,
      },
    });
    const PADDLE = 'https://sandbox-api.paddle.com';
    const paddle = (
      subscription: Record<string, unknown>,
      paidFrom: string | null = '2026-10-01T00:00:00Z',
      cancel: FakeResponse = { status: 200, body: { data: {} } },
    ): Record<string, FakeResponse> => ({
      [`GET ${PADDLE}/subscriptions/sub_01`]: { status: 200, body: { data: subscription } },
      [`GET ${PADDLE}/transactions/txn_01`]: {
        status: 200,
        body: { data: { billing_period: paidFrom ? { starts_at: paidFrom } : null } },
      },
      [`POST ${PADDLE}/subscriptions/sub_01/cancel`]: cancel,
    });
    const live = {
      status: 'active',
      current_billing_period: { starts_at: '2026-10-01T00:00:00.000Z' },
    };
    const cancelCall = (calls: RecordedCall[]) =>
      calls.find((c) => c.method === 'POST' && c.url.endsWith('/cancel'));

    it('cancels the subscription now when the current payment is refunded in full', async () => {
      for (const event of [
        adjustment(),
        adjustment({}, 'adjustment.created'),
        adjustment({ action: 'chargeback' }),
      ]) {
        const { deps: d, calls } = deps({
          ...paddle(live),
          [`POST ${SB}/rest/v1/rpc/void_referral`]: { status: 200, body: 0 },
        });
        const res = await handlePaddleWebhook(await signedRequest(event), d);
        expect(await res.json()).toEqual({ canceled: true });
        expect(cancelCall(calls)?.body).toEqual({ effective_from: 'immediately' });
        // A referral through this payment earns nothing (ADR-0035)…
        expect(calls.find((c) => c.url.endsWith('/rpc/void_referral'))?.body).toEqual({
          p_transaction_id: 'txn_01',
          p_reason: 'Refunded or charged back',
        });
        // …and the entitlement follows from Paddle's subscription.canceled event.
        expect(
          calls.filter((c) => c.url.startsWith(`${SB}/`) && !c.url.endsWith('/rpc/void_referral')),
        ).toHaveLength(0);
      }
    });

    it('keeps the plan for partial, pending, rejected or non-subscription adjustments', async () => {
      for (const data of [
        { type: 'partial' },
        { status: 'pending_approval' },
        { status: 'rejected' },
        { action: 'credit' },
        { action: 'chargeback_warning' },
        { subscription_id: null },
      ]) {
        const { deps: d, calls } = deps(paddle(live));
        const res = await handlePaddleWebhook(await signedRequest(adjustment(data)), d);
        expect(await res.json(), JSON.stringify(data)).toEqual({ ignored: true });
        expect(calls).toHaveLength(0);
      }
    });

    it('keeps the plan when an earlier period was refunded, or it is already canceled', async () => {
      const earlier = deps(paddle(live, '2026-09-01T00:00:00Z'));
      expect(
        await (await handlePaddleWebhook(await signedRequest(adjustment()), earlier.deps)).json(),
      ).toEqual({
        ignored: true,
      });
      expect(cancelCall(earlier.calls)).toBeUndefined();

      const noPeriod = deps(paddle(live, null));
      await handlePaddleWebhook(await signedRequest(adjustment()), noPeriod.deps);
      expect(cancelCall(noPeriod.calls)).toBeUndefined();

      const canceled = deps(paddle({ status: 'canceled', current_billing_period: null }));
      expect(
        await (await handlePaddleWebhook(await signedRequest(adjustment()), canceled.deps)).json(),
      ).toEqual({
        ignored: true,
      });
      expect(cancelCall(canceled.calls)).toBeUndefined();
    });

    it('treats a refused cancel as done, and asks Paddle to retry on server errors', async () => {
      const refused = deps(paddle(live, undefined, { status: 400, body: {} }));
      expect(
        await (await handlePaddleWebhook(await signedRequest(adjustment()), refused.deps)).json(),
      ).toEqual({
        canceled: true,
      });
      const down = deps(paddle(live, undefined, { status: 503, body: {} }));
      expect((await handlePaddleWebhook(await signedRequest(adjustment()), down.deps)).status).toBe(
        500,
      );
      const lookupDown = deps({
        [`GET ${PADDLE}/subscriptions/sub_01`]: { status: 502, body: {} },
      });
      expect(
        (await handlePaddleWebhook(await signedRequest(adjustment()), lookupDown.deps)).status,
      ).toBe(500);
    });
  });

  it('rejects unsigned or forged requests without touching the database', async () => {
    const { deps: d, calls } = deps({});
    const forged = await signedRequest(subscriptionEvent(), 'attacker-secret');
    expect((await handlePaddleWebhook(forged, d)).status).toBe(401);
    const unsigned = new Request('https://fn', { method: 'POST', body: '{}' });
    expect((await handlePaddleWebhook(unsigned, d)).status).toBe(401);
    expect((await handlePaddleWebhook(new Request('https://fn'), d)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('records a quarterly plan (billed every 3 months)', async () => {
    const { deps: d, calls } = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const quarterly = subscriptionEvent({
      items: [{ price: { id: 'pri_adv_quarter' } }],
      billing_cycle: { interval: 'month', frequency: 3 },
    });
    await handlePaddleWebhook(await signedRequest(quarterly), d);
    expect(applyCall(calls)?.body).toMatchObject({
      p_tier: 'advanced',
      p_billing_interval: 'quarter',
    });
  });

  it('records the full plan for a legacy price, too', async () => {
    const { deps: d, calls } = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const upgraded = subscriptionEvent({ items: [{ price: { id: 'pri_adv_year' } }] });
    await handlePaddleWebhook(await signedRequest(upgraded), d);
    expect(applyCall(calls)?.body).toMatchObject({ p_tier: 'advanced' });
  });

  it('acknowledges events it ignores, and asks Paddle to retry on failure', async () => {
    const ignored = deps({});
    const res = await handlePaddleWebhook(
      await signedRequest({ event_type: 'transaction.completed', data: {} }),
      ignored.deps,
    );
    expect(await res.json()).toEqual({ ignored: true });

    const failing = deps({
      ...ownCustomer,
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 503, body: {} },
    });
    expect(
      (await handlePaddleWebhook(await signedRequest(subscriptionEvent()), failing.deps)).status,
    ).toBe(500);
  });
});

describe('prices', () => {
  const preview = (currency: string, totals: [string, string][]) => ({
    status: 200,
    body: {
      data: {
        currency_code: currency,
        address: { country_code: 'GB' },
        details: {
          line_items: totals.map(([id, total]) => ({
            price: { id },
            formatted_totals: { total },
          })),
        },
      },
    },
  });

  it('returns Paddle’s prices for the caller’s location, cached briefly', async () => {
    const { deps: d, calls } = deps({
      'POST https://sandbox-api.paddle.com/pricing-preview': preview('GBP', [
        ['pri_pro_month', '£9.99'],
        ['pri_pro_quarter', '£24.00'],
        ['pri_pro_year', '£79.00'],
      ]),
    });
    const request = () =>
      new Request('https://fn', { headers: { 'x-forwarded-for': '81.2.69.142, 10.0.0.1' } });
    const res = await handlePrices(request(), d);
    expect(await res.json()).toEqual({
      currency: 'GBP',
      country: 'GB',
      // `advanced` repeats Pro for extensions before 0.4.4.
      prices: {
        pro: { month: '£9.99', quarter: '£24.00', year: '£79.00' },
        advanced: { month: '£9.99', quarter: '£24.00', year: '£79.00' },
      },
    });
    expect(calls[0]?.body).toMatchObject({ customer_ip_address: '81.2.69.142' });
    await handlePrices(request(), d);
    expect(calls).toHaveLength(1);
  });

  it('prices for the US without an IP, and reports Paddle failures', async () => {
    const ok = deps({ 'POST https://sandbox-api.paddle.com/pricing-preview': preview('USD', []) });
    await handlePrices(new Request('https://fn'), ok.deps);
    expect(ok.calls[0]?.body).toMatchObject({ address: { country_code: 'US' } });
    const down = deps({
      'POST https://sandbox-api.paddle.com/pricing-preview': { status: 500, body: {} },
    });
    const res = await handlePrices(
      new Request('https://fn', { headers: { 'x-forwarded-for': '203.0.113.9' } }),
      down.deps,
    );
    expect(res.status).toBe(502);
  });
});

describe('readEnv', () => {
  it('fails fast on a missing secret, and never guesses the Paddle environment', () => {
    expect(() => readEnv(() => undefined)).toThrow(/PADDLE_ENV|SUPABASE_URL/);
    expect(() => readEnv((n) => (n === 'PADDLE_ENV' ? 'live' : 'x'))).toThrow(/PADDLE_ENV/);
    expect(() => readEnv((n) => (n === 'PADDLE_ENV' ? undefined : 'x'))).toThrow(/PADDLE_ENV/);
    expect(ENV.paddle.environment).toBe('sandbox');
    expect(readEnv((n) => (n === 'PADDLE_ENV' ? 'production' : 'x')).paddle.environment).toBe(
      'production',
    );
  });
});

describe('web-handoff', () => {
  it('returns a single-use sign-in token for the signed-in user', async () => {
    const { deps: d, calls } = deps({
      [`POST ${SB}/auth/v1/admin/generate_link`]: {
        status: 200,
        body: { properties: { hashed_token: 'hash-123' } },
      },
    });
    const res = await handleWebHandoff(post({}), d);
    expect(await res.json()).toEqual({ tokenHash: 'hash-123' });
    const call = calls.find((c) => c.url.endsWith('/admin/generate_link'));
    expect(call?.body).toEqual({ type: 'magiclink', email: USER.email });
    expect(call?.headers.Authorization).toBe('Bearer service');
  });

  it('accepts the flat response shape and rejects strangers', async () => {
    const { deps: d } = deps({
      [`POST ${SB}/auth/v1/admin/generate_link`]: { status: 200, body: { hashed_token: 'h2' } },
    });
    expect(await (await handleWebHandoff(post({}), d)).json()).toEqual({ tokenHash: 'h2' });
    expect((await handleWebHandoff(post({}, 'bad-token'), d)).status).toBe(401);
  });

  it('fails cleanly when Supabase does', async () => {
    const { deps: d } = deps({
      [`POST ${SB}/auth/v1/admin/generate_link`]: { status: 500, body: {} },
    });
    expect((await handleWebHandoff(post({}), d)).status).toBe(500);
  });
});
