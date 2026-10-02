import {
  handleBillingPortal,
  handleChangePlan,
  handleCreateCheckout,
  handleDeleteAccount,
  handlePaddleWebhook,
  handleWebHandoff,
  tierOfPrice,
  type Deps,
} from '../../../supabase/functions/_shared/handlers.ts';
import { readEnv } from '../../../supabase/functions/_shared/env.ts';
import { fakeFetch, type FakeResponse } from '../helpers/fake-fetch';
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
      PADDLE_PRICE_ADVANCED_MONTHLY: 'pri_adv_month',
      PADDLE_PRICE_ADVANCED_QUARTERLY: 'pri_adv_quarter',
      PADDLE_PRICE_ADVANCED_YEARLY: 'pri_adv_year',
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
      custom_data: { user_id: USER.id },
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

describe('plan choice and change-plan', () => {
  it('create-checkout uses the price for the chosen tier and interval', async () => {
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
    expect(calls.find((c) => c.url.endsWith('/transactions'))?.body).toMatchObject({
      items: [{ price_id: 'pri_adv_year' }],
    });
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
    const res = await handleChangePlan(post({ tier: 'advanced', interval: 'month' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      items: [{ price_id: 'pri_adv_month', quantity: 1 }],
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
              result: { action: 'charge', amount: '848', currency_code: 'USD' },
            },
          },
        },
      },
    });
    const res = await handleChangePlan(
      post({ tier: 'advanced', interval: 'month', preview: true }),
      d,
    );
    expect(await res.json()).toEqual({
      preview: { action: 'charge', amount: 848, currency: 'USD' },
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

  it('maps price IDs back to tiers', () => {
    expect(tierOfPrice(ENV, 'pri_adv_year')).toBe('advanced');
    expect(tierOfPrice(ENV, 'pri_pro_month')).toBe('pro');
    expect(tierOfPrice(ENV, 'pri_unknown')).toBeUndefined();
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

  it('applies a verified subscription event via apply_billing_event', async () => {
    const { deps: d, calls } = deps({
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const res = await handlePaddleWebhook(await signedRequest(subscriptionEvent()), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    expect(calls[0]?.body).toEqual({
      p_user_id: USER.id,
      p_occurred_at: '2026-10-01T00:00:00.000Z',
      p_status: 'active',
      p_current_period_end: '2026-11-01T00:00:00Z',
      p_billing_interval: 'month',
      p_provider: 'paddle',
      p_customer_id: 'ctm_01',
      p_subscription_id: 'sub_01',
      p_tier: 'pro',
    });
    expect(calls[0]?.headers.apikey).toBe('service');
  });

  describe('a purchase made on the website (no user id)', () => {
    const website = () => subscriptionEvent({ custom_data: null });
    const apply = { [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true } };
    const tag = {
      'PATCH https://sandbox-api.paddle.com/subscriptions/sub_01': {
        status: 200,
        body: { data: {} },
      },
    };
    const customer = {
      'GET https://sandbox-api.paddle.com/customers/ctm_01': {
        status: 200,
        body: { data: { email: 'buyer@example.com' } },
      },
    };
    const NEW_ID = '99999999-9999-4999-8999-999999999999';

    it('goes to the account already billed as that customer', async () => {
      const { deps: d, calls } = deps({
        [`GET ${SB}/rest/v1/entitlements`]: { status: 200, body: [{ user_id: USER.id }] },
        ...apply,
        ...tag,
      });
      expect(await (await handlePaddleWebhook(await signedRequest(website()), d)).json()).toEqual({
        applied: true,
      });
      expect(calls.find((c) => c.url.includes('apply_billing_event'))?.body).toMatchObject({
        p_user_id: USER.id,
      });
      // Tagged, so later events carry the id.
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        custom_data: { user_id: USER.id },
      });
    });

    it('else to the account with the checkout email', async () => {
      const { deps: d, calls } = deps({
        [`GET ${SB}/rest/v1/entitlements`]: { status: 200, body: [] },
        ...customer,
        [`POST ${SB}/rest/v1/rpc/user_id_for_email`]: { status: 200, body: USER.id },
        ...apply,
        ...tag,
      });
      await handlePaddleWebhook(await signedRequest(website()), d);
      expect(calls.find((c) => c.url.endsWith('/user_id_for_email'))?.body).toEqual({
        p_email: 'buyer@example.com',
      });
      expect(calls.some((c) => c.url.endsWith('/admin/users'))).toBe(false);
      expect(calls.find((c) => c.url.includes('apply_billing_event'))?.body).toMatchObject({
        p_user_id: USER.id,
      });
    });

    it('else creates an account for that email, to sign in to later', async () => {
      const { deps: d, calls } = deps({
        [`GET ${SB}/rest/v1/entitlements`]: { status: 200, body: [] },
        ...customer,
        [`POST ${SB}/rest/v1/rpc/user_id_for_email`]: { status: 200, body: null },
        [`POST ${SB}/auth/v1/admin/users`]: { status: 200, body: { id: NEW_ID } },
        ...apply,
        ...tag,
      });
      await handlePaddleWebhook(await signedRequest(website()), d);
      const created = calls.find((c) => c.url.endsWith('/admin/users'));
      expect(created?.body).toEqual({ email: 'buyer@example.com', email_confirm: true });
      expect(created?.headers.Authorization).toBe('Bearer service');
      expect(calls.find((c) => c.url.includes('apply_billing_event'))?.body).toMatchObject({
        p_user_id: NEW_ID,
        p_tier: 'pro',
      });
    });

    it('asks Paddle to retry when the account lookup fails', async () => {
      const { deps: d } = deps({
        [`GET ${SB}/rest/v1/entitlements`]: { status: 503, body: {} },
      });
      expect((await handlePaddleWebhook(await signedRequest(website()), d)).status).toBe(500);
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
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const quarterly = subscriptionEvent({
      items: [{ price: { id: 'pri_adv_quarter' } }],
      billing_cycle: { interval: 'month', frequency: 3 },
    });
    await handlePaddleWebhook(await signedRequest(quarterly), d);
    expect(calls[0]?.body).toMatchObject({ p_tier: 'advanced', p_billing_interval: 'quarter' });
  });

  it('records the tier of the subscribed price', async () => {
    const { deps: d, calls } = deps({
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 200, body: true },
    });
    const upgraded = subscriptionEvent({ items: [{ price: { id: 'pri_adv_year' } }] });
    await handlePaddleWebhook(await signedRequest(upgraded), d);
    expect(calls[0]?.body).toMatchObject({ p_tier: 'advanced' });
  });

  it('acknowledges events it ignores, and asks Paddle to retry on failure', async () => {
    const ignored = deps({});
    const res = await handlePaddleWebhook(
      await signedRequest({ event_type: 'transaction.completed', data: {} }),
      ignored.deps,
    );
    expect(await res.json()).toEqual({ ignored: true });

    const failing = deps({
      [`POST ${SB}/rest/v1/rpc/apply_billing_event`]: { status: 503, body: {} },
    });
    expect(
      (await handlePaddleWebhook(await signedRequest(subscriptionEvent()), failing.deps)).status,
    ).toBe(500);
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
