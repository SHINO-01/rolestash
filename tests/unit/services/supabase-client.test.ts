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
