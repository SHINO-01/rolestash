import { BackendError, SupabaseClient } from '@/services/backend/supabase-client';
import { fakeFetch, type FakeResponse } from '../helpers/fake-fetch';

const SB = 'https://ref.supabase.co';
const client = (routes: Record<string, FakeResponse>) => {
  const f = fakeFetch(routes);
  return { c: new SupabaseClient({ url: SB, anonKey: 'anon' }, f.fetch), calls: f.calls };
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof BackendError ? e.code : 'other'),
  );

describe('SupabaseClient error mapping', () => {
  it('reports network failures as "network"', async () => {
    const c = new SupabaseClient({ url: SB, anonKey: 'anon' }, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    expect(await code(c.sendEmailCode('a@b.c'))).toBe('network');
  });

  it('maps rate limits, bad codes and server errors', async () => {
    const { c } = client({
      [`POST ${SB}/auth/v1/otp`]: {
        status: 429,
        body: { error_code: 'over_email_send_rate_limit' },
      },
      [`POST ${SB}/auth/v1/verify`]: { status: 400, body: { error_code: 'otp_expired' } },
      [`POST ${SB}/auth/v1/token`]: { status: 500, body: {} },
    });
    expect(await code(c.sendEmailCode('a@b.c'))).toBe('rate_limited');
    expect(await code(c.verifyEmailCode('a@b.c', '1'))).toBe('invalid_code');
    expect(await code(c.signInWithIdToken('x', 'y'))).toBe('server');
    expect(await code(c.refresh('r'))).toBe('server');
  });

  it('rejects malformed token and entitlement responses', async () => {
    const { c } = client({
      [`POST ${SB}/auth/v1/verify`]: { status: 200, body: { access_token: 'only' } },
      [`GET ${SB}/rest/v1/entitlements`]: { status: 200, body: [{ status: 'bogus' }] },
    });
    expect(await code(c.verifyEmailCode('a@b.c', '123456'))).toBe('server');
    expect(await code(c.entitlement('t'))).toBe('server');
  });

  it('treats non-JSON bodies as server errors', async () => {
    const f = (() =>
      Promise.resolve(
        new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      )) as typeof fetch;
    const c = new SupabaseClient({ url: SB, anonKey: 'anon' }, f);
    expect(await code(c.sendEmailCode('a@b.c'))).toBe('server');
    expect(await code(c.functionUrl('billing-portal', 't'))).toBe('server');
  });

  it('handles entitlement reads: none, expired session, errors', async () => {
    const none = client({ [`GET ${SB}/rest/v1/entitlements`]: { status: 200, body: [] } });
    expect(await none.c.entitlement('t')).toBeUndefined();
    const expired = client({ [`GET ${SB}/rest/v1/entitlements`]: { status: 401, body: {} } });
    expect(await code(expired.c.entitlement('t'))).toBe('session_expired');
    const broken = client({ [`GET ${SB}/rest/v1/entitlements`]: { status: 503, body: {} } });
    expect(await code(broken.c.entitlement('t'))).toBe('server');
  });

  it('reads a complimentary entitlement (ADR-0025)', async () => {
    const { c } = client({
      [`GET ${SB}/rest/v1/entitlements`]: {
        status: 200,
        body: [
          {
            status: 'active',
            tier: 'advanced',
            current_period_end: '9999-12-31T00:00:00+00:00',
            provider_customer_id: null,
            complimentary: 'owner',
          },
        ],
      },
    });
    expect(await c.entitlement('t')).toMatchObject({
      tier: 'advanced',
      complimentary: true,
      hasBillingAccount: false,
      currentPeriodEnd: '9999-12-31T00:00:00.000Z',
    });
  });

  it('maps Edge Function responses', async () => {
    const { c } = client({
      [`POST ${SB}/functions/v1/create-checkout`]: { status: 401, body: {} },
      [`POST ${SB}/functions/v1/billing-portal`]: { status: 200, body: { nope: true } },
      [`POST ${SB}/functions/v1/delete-account`]: { status: 500, body: {} },
    });
    expect(await code(c.functionUrl('create-checkout', 't'))).toBe('session_expired');
    expect(await code(c.functionUrl('billing-portal', 't'))).toBe('server');
    expect(await code(c.deleteAccount('t'))).toBe('server');
    const expired = client({
      [`POST ${SB}/functions/v1/delete-account`]: { status: 401, body: {} },
    });
    expect(await code(expired.c.deleteAccount('t'))).toBe('session_expired');
  });

  it('reads which OAuth providers are enabled', async () => {
    const on = client({
      [`GET ${SB}/auth/v1/settings`]: { status: 200, body: { external: { google: true } } },
    });
    expect(await on.c.oauthProviders()).toEqual({ google: true });
    const off = client({
      [`GET ${SB}/auth/v1/settings`]: { status: 200, body: { external: { email: true } } },
    });
    expect(await off.c.oauthProviders()).toEqual({ google: false });
    const down = client({ [`GET ${SB}/auth/v1/settings`]: { status: 500, body: {} } });
    expect(await code(down.c.oauthProviders())).toBe('server');
  });

  it('never fails sign-out, even offline', async () => {
    const c = new SupabaseClient({ url: SB, anonKey: 'anon' }, () =>
      Promise.reject(new TypeError('offline')),
    );
    await expect(c.signOut('t')).resolves.toBeUndefined();
  });

  it('sends the anon key everywhere and the user token when given', async () => {
    const { c, calls } = client({
      [`POST ${SB}/auth/v1/otp`]: { status: 200, body: {} },
      [`GET ${SB}/rest/v1/entitlements`]: { status: 200, body: [] },
    });
    await c.sendEmailCode('a@b.c');
    await c.entitlement('user-token');
    expect(calls.map((x) => [x.headers.apikey, x.headers.Authorization])).toEqual([
      ['anon', undefined],
      ['anon', 'Bearer user-token'],
    ]);
  });
});

describe('SupabaseClient sync calls (ADR-0016)', () => {
  const D = 'a0000000-0000-4000-8000-000000000001';

  it('registers a device and reads the limit result', async () => {
    const { c, calls } = client({
      [`POST ${SB}/rest/v1/rpc/register_device`]: {
        status: 200,
        body: { ok: false, reason: 'device_limit', limit: 3 },
      },
    });
    expect(
      await c.registerDevice('tok', { id: D, name: 'Chrome on Linux', kind: 'computer' }),
    ).toEqual({
      ok: false,
      reason: 'device_limit',
      limit: 3,
    });
    expect(calls[0]?.body).toEqual({ p_id: D, p_name: 'Chrome on Linux', p_kind: 'computer' });
    expect(calls[0]?.headers.Authorization).toBe('Bearer tok');
  });

  it('lists and removes devices', async () => {
    const { c, calls } = client({
      [`GET ${SB}/rest/v1/devices`]: {
        status: 200,
        body: [
          {
            id: D,
            name: 'Laptop',
            kind: 'computer',
            created_at: '2026-10-01T00:00:00+00:00',
            last_seen_at: '2026-10-01T01:00:00+00:00',
          },
        ],
      },
      [`DELETE ${SB}/rest/v1/devices`]: { status: 204, body: null },
    });
    expect(await c.listDevices('tok')).toEqual([
      {
        id: D,
        name: 'Laptop',
        kind: 'computer',
        createdAt: '2026-10-01T00:00:00.000Z',
        lastSeenAt: '2026-10-01T01:00:00.000Z',
      },
    ]);
    await c.removeDevice('tok', D);
    expect(calls[1]?.url).toBe(`${SB}/rest/v1/devices?id=eq.${D}`);
  });

  it('pushes changes and pulls rows, with revisions as numbers', async () => {
    const { c, calls } = client({
      [`POST ${SB}/rest/v1/rpc/push_jobs`]: { status: 200, body: 2 },
      [`POST ${SB}/rest/v1/rpc/pull_jobs`]: {
        status: 200,
        body: [
          {
            job_id: 'j1',
            data: { id: 'j1' },
            deleted: false,
            updated_at: '2026-10-01T00:00:00+00:00',
            revision: '41',
          },
        ],
      },
    });
    expect(await c.pushJobs('tok', D, [{ id: 'j1', updatedAt: 'x', data: {} }])).toBe(2);
    expect(await c.pullJobs('tok', D, 40, 500)).toEqual([
      {
        id: 'j1',
        data: { id: 'j1' },
        deleted: false,
        updatedAt: '2026-10-01T00:00:00.000Z',
        revision: 41,
      },
    ]);
    expect(calls[1]?.body).toEqual({ p_device: D, p_after: 40, p_limit: 500 });
  });

  it('maps sync refusals, expired sessions and bad payloads', async () => {
    const { c } = client({
      [`POST ${SB}/rest/v1/rpc/push_jobs`]: { status: 403, body: { code: '42501' } },
      [`POST ${SB}/rest/v1/rpc/pull_jobs`]: { status: 401, body: {} },
      [`POST ${SB}/rest/v1/rpc/register_device`]: { status: 200, body: { ok: 'maybe' } },
      [`GET ${SB}/rest/v1/devices`]: { status: 200, body: [{ id: 1 }] },
      [`DELETE ${SB}/rest/v1/devices`]: { status: 500, body: {} },
    });
    expect(await code(c.pushJobs('tok', D, []))).toBe('sync_not_allowed');
    expect(await code(c.pullJobs('tok', D, 0, 10))).toBe('session_expired');
    expect(await code(c.registerDevice('tok', { id: D, name: 'x', kind: 'web' }))).toBe('server');
    expect(await code(c.listDevices('tok'))).toBe('server');
    expect(await code(c.removeDevice('tok', D))).toBe('server');
  });
});

describe('SupabaseClient email updates (ADR-0014)', () => {
  it('gets and rotates the forwarding address', async () => {
    const { c, calls } = client({
      [`POST ${SB}/rest/v1/rpc/my_inbox`]: {
        status: 200,
        body: {
          ok: true,
          address: 'k3x9q2w7m4p8r5t6abcd@in.rolestash.com',
          created_at: 'x',
          rotated_at: null,
        },
      },
      [`POST ${SB}/rest/v1/rpc/rotate_inbox`]: {
        status: 200,
        body: {
          ok: true,
          address: 'newtokennewtokennewt@in.rolestash.com',
          rotated_at: '2026-10-01T00:00:00+00:00',
          share_learning: false,
        },
      },
    });
    expect(await c.myInbox('tok')).toEqual({
      ok: true,
      address: 'k3x9q2w7m4p8r5t6abcd@in.rolestash.com',
      shareLearning: true,
    });
    expect(await c.myInbox('tok', true)).toEqual({
      ok: true,
      address: 'newtokennewtokennewt@in.rolestash.com',
      rotatedAt: '2026-10-01T00:00:00.000Z',
      shareLearning: false,
    });
    expect(calls[0]?.headers.Authorization).toBe('Bearer tok');
  });

  it('reports a plan that has no address, and rejects odd answers', async () => {
    const { c } = client({
      [`POST ${SB}/rest/v1/rpc/my_inbox`]: {
        status: 200,
        body: { ok: false, reason: 'plan_required' },
      },
      [`POST ${SB}/rest/v1/rpc/rotate_inbox`]: {
        status: 200,
        body: { ok: true, address: 'not an email' },
      },
    });
    expect(await c.myInbox('tok')).toEqual({ ok: false, reason: 'plan_required' });
    expect(await code(c.myInbox('tok', true))).toBe('server');
  });

  it('pages events by id and deletes processed ones', async () => {
    const { c, calls } = client({
      [`GET ${SB}/rest/v1/email_events`]: {
        status: 200,
        body: [{ id: 7, event: { intent: 'other' } }],
      },
      [`DELETE ${SB}/rest/v1/email_events`]: { status: 204, body: null },
    });
    expect(await c.emailEvents('tok', 6, 100)).toEqual([{ id: 7, event: { intent: 'other' } }]);
    expect(calls[0]?.url).toBe(
      `${SB}/rest/v1/email_events?select=id,event&id=gt.6&order=id.asc&limit=100`,
    );
    await c.deleteEmailEvents('tok', [7, 8]);
    expect(calls[1]?.url).toBe(`${SB}/rest/v1/email_events?id=in.(7,8)`);
    await c.deleteEmailEvents('tok', []);
    expect(calls).toHaveLength(2);
  });

  it('maps errors on event calls', async () => {
    const { c } = client({
      [`GET ${SB}/rest/v1/email_events`]: { status: 401, body: {} },
      [`DELETE ${SB}/rest/v1/email_events`]: { status: 401, body: {} },
    });
    expect(await code(c.emailEvents('tok', 0, 10))).toBe('session_expired');
    expect(await code(c.deleteEmailEvents('tok', [1]))).toBe('session_expired');
    const bad = client({
      [`GET ${SB}/rest/v1/email_events`]: { status: 200, body: [{ id: 'x' }] },
    });
    expect(await code(bad.c.emailEvents('tok', 0, 10))).toBe('server');
    const down = client({
      [`GET ${SB}/rest/v1/email_events`]: { status: 500, body: {} },
      [`DELETE ${SB}/rest/v1/email_events`]: { status: 500, body: {} },
    });
    expect(await code(down.c.emailEvents('tok', 0, 10))).toBe('server');
    expect(await code(down.c.deleteEmailEvents('tok', [1]))).toBe('server');
  });
});

describe('SupabaseClient shared learning (ADR-0014 §6)', () => {
  it('sends votes and the sharing switch', async () => {
    const { c, calls } = client({
      [`POST ${SB}/rest/v1/rpc/vote_email_knowledge`]: {
        status: 200,
        body: { ok: true, recorded: 1 },
      },
      [`POST ${SB}/rest/v1/rpc/set_email_sharing`]: { status: 200, body: { ok: true } },
    });
    const vote = {
      kind: 'template' as const,
      key: 'a'.repeat(64),
      value: 'rejected',
      ticket: `20261001.${'1'.repeat(64)}`,
    };
    await c.voteEmailKnowledge('tok', [vote]);
    await c.voteEmailKnowledge('tok', []);
    await c.setEmailSharing('tok', false);
    expect(calls.map((x) => x.body)).toEqual([{ p_votes: [vote] }, { p_on: false }]);
  });
});
