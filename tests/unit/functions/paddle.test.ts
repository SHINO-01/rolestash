import {
  PaddleApiError,
  PaddleClient,
  toBillingEvent,
  verifyPaddleSignature,
} from '../../../supabase/functions/_shared/paddle.ts';
import { fakeFetch } from '../helpers/fake-fetch';
import { subscriptionEvent } from './fixtures';

const SECRET = 'pdl_ntfset_test_secret';
const NOW = new Date('2026-10-01T00:00:00.000Z');
const TS = String(NOW.getTime() / 1000);

async function sign(body: string, ts = TS, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const USER = '11111111-1111-4111-8111-111111111111';

describe('verifyPaddleSignature', () => {
  const body = '{"event_type":"subscription.created"}';

  it('accepts a valid signature, including one of several during rotation', async () => {
    const h1 = await sign(body);
    expect(await verifyPaddleSignature(body, `ts=${TS};h1=${h1}`, SECRET, NOW)).toBe(true);
    const old = await sign(body, TS, 'old_secret');
    expect(await verifyPaddleSignature(body, `ts=${TS};h1=${old};h1=${h1}`, SECRET, NOW)).toBe(
      true,
    );
  });

  it('rejects tampered bodies, wrong secrets and malformed headers', async () => {
    const h1 = await sign(body);
    expect(await verifyPaddleSignature(`${body} `, `ts=${TS};h1=${h1}`, SECRET, NOW)).toBe(false);
    expect(await verifyPaddleSignature(body, `ts=${TS};h1=${h1}`, 'other', NOW)).toBe(false);
    for (const header of [null, '', `h1=${h1}`, `ts=${TS}`, `ts=abc;h1=${h1}`]) {
      expect(await verifyPaddleSignature(body, header, SECRET, NOW)).toBe(false);
    }
    expect(await verifyPaddleSignature(body, `ts=${TS};h1=${h1}`, '', NOW)).toBe(false);
  });

  it('rejects replays outside the tolerance window', async () => {
    const oldTs = String(NOW.getTime() / 1000 - 301);
    const h1 = await sign(body, oldTs);
    expect(await verifyPaddleSignature(body, `ts=${oldTs};h1=${h1}`, SECRET, NOW)).toBe(false);
  });
});

describe('toBillingEvent', () => {
  it('maps an active subscription', () => {
    expect(toBillingEvent(subscriptionEvent())).toEqual({
      userId: USER,
      occurredAt: '2026-10-01T00:00:00.000Z',
      status: 'active',
      currentPeriodEnd: '2026-11-01T00:00:00Z',
      billingInterval: 'month',
      customerId: 'ctm_01',
      subscriptionId: 'sub_01',
    });
  });

  it('ends access at cancellation when there is no current period', () => {
    const event = toBillingEvent(
      subscriptionEvent({
        status: 'canceled',
        current_billing_period: null,
        canceled_at: '2026-10-05T00:00:00Z',
        billing_cycle: { interval: 'year' },
      }),
    );
    expect(event).toMatchObject({
      status: 'canceled',
      currentPeriodEnd: '2026-10-05T00:00:00Z',
      billingInterval: 'year',
    });
  });

  it('ignores events we do not act on', () => {
    expect(toBillingEvent({ event_type: 'transaction.completed', data: {} })).toBeNull();
    expect(toBillingEvent(subscriptionEvent({ custom_data: null }))).toBeNull();
    expect(toBillingEvent(subscriptionEvent({ custom_data: { user_id: 'nope' } }))).toBeNull();
    expect(toBillingEvent(subscriptionEvent({ status: 'weird' }))).toBeNull();
    expect(toBillingEvent(null)).toBeNull();
    expect(toBillingEvent({ event_type: 'subscription.updated' })).toBeNull();
  });
});

describe('PaddleClient', () => {
  it('creates a checkout carrying the user id, on the sandbox until production', async () => {
    const f = fakeFetch({
      'POST https://sandbox-api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: { url: 'https://rolestash.com/pay/?_ptxn=txn_1' } } },
      },
    });
    const client = new PaddleClient({ apiKey: 'key', environment: 'sandbox' }, f.fetch);
    const url = await client.createCheckout({
      priceId: 'pri_m',
      userId: USER,
      customerId: 'ctm_01',
    });
    expect(url).toBe('https://rolestash.com/pay/?_ptxn=txn_1');
    expect(f.calls[0]).toMatchObject({
      headers: { Authorization: 'Bearer key' },
      body: {
        items: [{ price_id: 'pri_m', quantity: 1 }],
        custom_data: { user_id: USER },
        customer_id: 'ctm_01',
      },
    });
  });

  it('uses the production API and surfaces API errors', async () => {
    const f = fakeFetch({
      'POST https://api.paddle.com/customers/ctm_01/portal-sessions': {
        status: 201,
        body: { data: { urls: { general: { overview: 'https://portal' } } } },
      },
      'POST https://api.paddle.com/subscriptions/sub_01/cancel': { status: 404, body: {} },
      'POST https://api.paddle.com/transactions': {
        status: 201,
        body: { data: { checkout: null } },
      },
    });
    const client = new PaddleClient({ apiKey: 'key', environment: 'production' }, f.fetch);
    expect(await client.createPortalSession('ctm_01', 'sub_01')).toBe('https://portal');
    expect(f.calls[0]?.body).toEqual({ subscription_ids: ['sub_01'] });
    await expect(client.cancelNow('sub_01')).rejects.toMatchObject({ status: 404 });
    await expect(
      client.createCheckout({ priceId: 'p', userId: USER, customerId: null }),
    ).rejects.toBeInstanceOf(PaddleApiError);
  });
});
