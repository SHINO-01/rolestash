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
