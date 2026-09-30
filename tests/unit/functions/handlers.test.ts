import {
  handleBillingPortal,
  handleCreateCheckout,
  handleDeleteAccount,
  handlePaddleWebhook,
  type Deps,
} from '../../../supabase/functions/_shared/handlers.ts';
import { readEnv } from '../../../supabase/functions/_shared/env.ts';
import { fakeFetch, type FakeResponse } from './fake-fetch';
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
      PADDLE_API_KEY: 'pdl_key',
      PADDLE_WEBHOOK_SECRET: 'whsec',
      PADDLE_PRICE_MONTHLY: 'pri_month',
      PADDLE_PRICE_YEARLY: 'pri_year',
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
      'POST https://sandbox-api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_1' } } },
      },
    });
    const res = await handleCreateCheckout(post({ interval: 'year' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://rolestash.com/pay/?_ptxn=txn_1' });
    const paddleCall = calls.find((c) => c.url.includes('paddle'));
    expect(paddleCall?.body).toMatchObject({
      items: [{ price_id: 'pri_year' }],
      custom_data: { user_id: USER.id },
    });
    // The entitlement lookup uses the service role, scoped to this user.
    const lookup = calls.find((c) => c.url.includes('/rest/v1/entitlements'));
    expect(lookup?.url).toContain(`user_id=eq.${USER.id}`);
    expect(lookup?.headers.apikey).toBe('service');
  });

  it('create-checkout rejects bad intervals and existing subscribers', async () => {
    const { deps: d } = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute({
        status: 'active',
        provider_subscription_id: 'sub_01',
      }),
    });
    expect((await handleCreateCheckout(post({ interval: 'week' }), d)).status).toBe(400);
    const res = await handleCreateCheckout(post({ interval: 'month' }), d);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_subscribed' });
  });

  it('maps Paddle outages to 502 and our own failures to 500', async () => {
    const paddleDown = deps({
      [`GET ${SB}/rest/v1/entitlements`]: entitlementRoute(null),
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
    });
    expect(calls[0]?.headers.apikey).toBe('service');
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
  it('fails fast on a missing secret and defaults Paddle to the sandbox', () => {
    expect(() => readEnv(() => undefined)).toThrow(/SUPABASE_URL/);
    expect(ENV.paddle.environment).toBe('sandbox');
    expect(readEnv((n) => (n === 'PADDLE_ENV' ? 'production' : 'x')).paddle.environment).toBe(
      'production',
    );
  });
});
