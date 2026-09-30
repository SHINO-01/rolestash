import { FREE_ACTIVE_JOB_LIMIT } from '@/domain/plan';
import { AccountService } from '@/services/account-service';
import {
  BackendError,
  codeChallenge,
  createCodeVerifier,
  SupabaseClient,
} from '@/services/backend/supabase-client';
import { createServices } from '@/services/container';
import { JobLimitError } from '@/services/job-service';
import type { ExtractorRunner, WebAuthFlow } from '@/services/ports';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { ACCOUNT_ENTITLEMENT_KEY, ACCOUNT_SESSION_KEY } from '@/storage/keys';
import { fakeFetch, type FakeResponse, type RecordedCall } from '../helpers/fake-fetch';
import { makeJob, testContext } from '../helpers/factories';

const SB = 'https://ref.supabase.co';
const CONFIG = { url: SB, anonKey: 'anon-key' };
const START = '2026-10-01T00:00:00.000Z';
const USER = { id: 'u-1', email: 'jo@example.com' };

const token = (access: string, expiresIn = 3600): FakeResponse => ({
  status: 200,
  body: { access_token: access, refresh_token: `r-${access}`, expires_in: expiresIn, user: USER },
});
const trialRow = (days = 30): FakeResponse => ({
  status: 200,
  body: [
    {
      status: 'trialing',
      trial_ends_at: new Date(Date.parse(START) + days * 86_400_000).toISOString(),
      current_period_end: null,
      provider_customer_id: null,
    },
  ],
});

class FakeAuthFlow implements WebAuthFlow {
  launched: string[] = [];
  constructor(private readonly respond: (url: string) => string) {}
  redirectUrl() {
    return 'https://ext-id.chromiumapp.org/';
  }
  launch(url: string) {
    this.launched.push(url);
    return Promise.resolve(this.respond(url));
  }
}

function setup(routes: Record<string, FakeResponse | ((c: RecordedCall) => FakeResponse)> = {}) {
  const ctx = testContext(START);
  const store = new MemoryKeyValueStore();
  const f = fakeFetch({
    [`POST ${SB}/auth/v1/verify`]: (c) =>
      (c.body as { token: string }).token === '123456'
        ? token('a1')
        : { status: 403, body: { error_code: 'otp_expired' } },
    [`GET ${SB}/rest/v1/entitlements`]: trialRow(),
    ...routes,
  });
  const client = new SupabaseClient(CONFIG, f.fetch, ctx.now);
  const flow = new FakeAuthFlow((url) => {
    const redirect = new URL(url).searchParams.get('redirect_to') ?? '';
    return `${redirect}?code=auth-code`;
  });
  const account = new AccountService(store, client, flow, ctx.now);
  return { ctx, store, calls: f.calls, account, flow, client };
}

describe('AccountService sign-in', () => {
  it('starts signed out on Free', async () => {
    const { account } = setup();
    expect(await account.state()).toEqual({
      signedIn: false,
      plan: { plan: 'free', reason: 'no-account' },
      hasBillingAccount: false,
    });
  });

  it('signs in with an email code and picks up the trial', async () => {
    const { account, calls } = setup({ [`POST ${SB}/auth/v1/otp`]: { status: 200, body: {} } });
    await account.requestEmailCode('  Jo@Example.com ');
    expect(calls[0]?.body).toEqual({ email: 'jo@example.com', create_user: true });
    expect(calls[0]?.headers.apikey).toBe('anon-key');

    await account.verifyEmailCode('jo@example.com', '123 456');
    const state = await account.state();
    expect(state).toMatchObject({
      signedIn: true,
      email: 'jo@example.com',
      plan: { plan: 'pro', reason: 'trial', trialDaysLeft: 30 },
      hasBillingAccount: false,
      checkedAt: START,
    });
    // The entitlement read uses the user's token, so RLS scopes it.
    const read = calls.find((c) => c.url.includes('/rest/v1/entitlements'));
    expect(read?.headers.Authorization).toBe('Bearer a1');
  });

  it('reports a wrong code without signing in', async () => {
    const { account } = setup();
    await expect(account.verifyEmailCode('jo@example.com', '000000')).rejects.toMatchObject({
      code: 'invalid_code',
    });
    expect((await account.state()).signedIn).toBe(false);
  });

  it('signs in with Google through PKCE', async () => {
    let exchanged: unknown;
    const { account, flow } = setup({
      [`POST ${SB}/auth/v1/token`]: (c) => {
        exchanged = c.body;
        return token('g1');
      },
    });
    await account.signInWithGoogle();
    const url = new URL(flow.launched[0] ?? '');
    expect(url.origin + url.pathname).toBe(`${SB}/auth/v1/authorize`);
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('https://ext-id.chromiumapp.org/');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    const { auth_code, code_verifier } = exchanged as { auth_code: string; code_verifier: string };
    expect(auth_code).toBe('auth-code');
    expect(await codeChallenge(code_verifier)).toBe(url.searchParams.get('code_challenge'));
    expect((await account.state()).signedIn).toBe(true);
  });

  it('offers Google only when the project enables it, and not when offline', async () => {
    const on = setup({
      [`GET ${SB}/auth/v1/settings`]: { status: 200, body: { external: { google: true } } },
    });
    expect(await on.account.googleSignInAvailable()).toBe(true);
    const off = setup({
      [`GET ${SB}/auth/v1/settings`]: { status: 200, body: { external: { google: false } } },
    });
    expect(await off.account.googleSignInAvailable()).toBe(false);
    const offline = new AccountService(
      new MemoryKeyValueStore(),
      new SupabaseClient(CONFIG, () => Promise.reject(new TypeError('offline'))),
      new FakeAuthFlow(() => ''),
    );
    expect(await offline.googleSignInAvailable()).toBe(false);
  });

  it('fails Google sign-in cleanly when the redirect carries no code', async () => {
    const { store } = setup();
    const client = new SupabaseClient(CONFIG, fakeFetch({}).fetch);
    const flow = new FakeAuthFlow(() => 'https://ext-id.chromiumapp.org/?error=access_denied');
    const account = new AccountService(store, client, flow);
    await expect(account.signInWithGoogle()).rejects.toBeInstanceOf(BackendError);
    expect((await account.state()).signedIn).toBe(false);
  });
});

describe('AccountService session and entitlement', () => {
  async function signedIn(routes: Parameters<typeof setup>[0] = {}) {
    const s = setup(routes);
    await s.account.verifyEmailCode('jo@example.com', '123456');
    return s;
  }

  it('refreshes an expiring token before calling the backend', async () => {
    const s = await signedIn({ [`POST ${SB}/auth/v1/token`]: token('a2') });
    s.ctx.advance(3600_000 - 30_000); // within the 60 s skew
    await s.account.refreshEntitlement();
    const reads = s.calls.filter((c) => c.url.includes('/rest/v1/entitlements'));
    expect(reads.at(-1)?.headers.Authorization).toBe('Bearer a2');
    expect(s.calls.find((c) => c.url.includes('grant_type=refresh_token'))?.body).toEqual({
      refresh_token: 'r-a1',
    });
  });

  it('signs out locally when the refresh token is rejected', async () => {
    const s = await signedIn({ [`POST ${SB}/auth/v1/token`]: { status: 400, body: {} } });
    s.ctx.advance(2 * 3600_000);
    await expect(s.account.checkoutUrl('month')).rejects.toMatchObject({
      code: 'session_expired',
    });
    expect(await s.store.get([ACCOUNT_SESSION_KEY, ACCOUNT_ENTITLEMENT_KEY])).toEqual({});
  });

  it('keeps the cached entitlement when offline, within the grace period', async () => {
    const s = await signedIn();
    const offline = new AccountService(
      s.store,
      new SupabaseClient(CONFIG, () => Promise.reject(new TypeError('offline')), s.ctx.now),
      s.flow,
      s.ctx.now,
    );
    s.ctx.advance(3 * 86_400_000);
    expect(await offline.refreshEntitlement()).toBe(false);
    expect((await offline.state()).plan.plan).toBe('pro');
    s.ctx.advance(5 * 86_400_000); // 8 days without confirmation
    expect((await offline.state()).plan).toEqual({ plan: 'free', reason: 'stale' });
  });

  it('refreshIfStale only calls the server when the snapshot is old', async () => {
    const s = await signedIn();
    const before = s.calls.length;
    await s.account.refreshIfStale();
    expect(s.calls.length).toBe(before);
    s.ctx.advance(61 * 60_000);
    await s.account.refreshIfStale();
    expect(s.calls.length).toBe(before + 1);
  });

  it('reflects a paid subscription and exposes billing links', async () => {
    const s = await signedIn({
      [`GET ${SB}/rest/v1/entitlements`]: {
        status: 200,
        body: [
          {
            status: 'active',
            trial_ends_at: null,
            current_period_end: '2026-11-01T00:00:00+00:00',
            provider_customer_id: 'ctm_1',
          },
        ],
      },
      [`POST ${SB}/functions/v1/create-checkout`]: (c) => ({
        status: 200,
        body: {
          url: `https://rolestash.com/pay/?_ptxn=${(c.body as { interval: string }).interval}`,
        },
      }),
      [`POST ${SB}/functions/v1/billing-portal`]: { status: 200, body: { url: 'https://portal' } },
    });
    expect(await s.account.state()).toMatchObject({
      plan: { plan: 'pro', reason: 'subscribed', endsAt: '2026-11-01T00:00:00.000Z' },
      hasBillingAccount: true,
    });
    expect(await s.account.checkoutUrl('year')).toBe('https://rolestash.com/pay/?_ptxn=year');
    expect(await s.account.billingPortalUrl()).toBe('https://portal');
  });

  it('maps function errors to typed codes', async () => {
    const s = await signedIn({
      [`POST ${SB}/functions/v1/create-checkout`]: {
        status: 409,
        body: { error: 'already_subscribed' },
      },
      [`POST ${SB}/functions/v1/billing-portal`]: {
        status: 404,
        body: { error: 'no_subscription' },
      },
    });
    await expect(s.account.checkoutUrl('month')).rejects.toMatchObject({
      code: 'already_subscribed',
    });
    await expect(s.account.billingPortalUrl()).rejects.toMatchObject({ code: 'no_subscription' });
  });

  it('signs out and deletes accounts, keeping local jobs', async () => {
    const s = await signedIn({
      [`POST ${SB}/auth/v1/logout`]: { status: 204, body: null },
      [`POST ${SB}/functions/v1/delete-account`]: { status: 200, body: { deleted: true } },
    });
    await s.store.set({ 'job:keep': makeJob({ id: 'keep' }) });
    await s.account.deleteAccount();
    expect((await s.account.state()).signedIn).toBe(false);
    expect(Object.keys(await s.store.get(null))).toEqual(['job:keep']);

    const t = await signedIn({ [`POST ${SB}/auth/v1/logout`]: { status: 500, body: {} } });
    await t.account.signOut();
    expect((await t.account.state()).signedIn).toBe(false);
  });

  it('notifies subscribers about account changes only', async () => {
    const s = setup();
    const seen: number[] = [];
    s.account.subscribe(() => seen.push(1));
    await s.store.set({ 'job:x': makeJob() });
    expect(seen).toHaveLength(0);
    await s.account.verifyEmailCode('jo@example.com', '123456');
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('accounts in the service container', () => {
  const runner: ExtractorRunner = {
    run: () => Promise.resolve([]),
    snapshot: () => Promise.resolve({ url: '', title: '', html: '' }),
  };

  it('has no account service and no limit without a backend', async () => {
    const services = createServices(new MemoryKeyValueStore(), runner, testContext());
    await services.ready;
    expect(services.account).toBeUndefined();
    expect(await services.jobService.limitCheck()).toBeUndefined();
  });

  it('enforces the free limit once the trial ends, and not during it', async () => {
    const ctx = testContext(START);
    const store = new MemoryKeyValueStore();
    const f = fakeFetch({
      [`POST ${SB}/auth/v1/verify`]: token('a1'),
      [`GET ${SB}/rest/v1/entitlements`]: trialRow(1),
    });
    const services = createServices(store, runner, ctx, {
      client: new SupabaseClient(CONFIG, f.fetch, ctx.now),
      authFlow: new FakeAuthFlow(() => ''),
    });
    await services.ready;
    await services.jobs.saveMany(
      Array.from({ length: FREE_ACTIVE_JOB_LIMIT }, (_, i) => makeJob({ id: `j${i}` })),
    );
    const posting = { title: 'One more', company: 'Acme', employmentTypes: [] };

    // Signed out: Free.
    await expect(services.jobService.createManual({ posting })).rejects.toBeInstanceOf(
      JobLimitError,
    );
    await services.account?.verifyEmailCode('jo@example.com', '123456');
    await expect(services.jobService.createManual({ posting })).resolves.toBeDefined();
    ctx.advance(2 * 86_400_000);
    await expect(services.jobService.createManual({ posting })).rejects.toBeInstanceOf(
      JobLimitError,
    );
  });
});

describe('PKCE helpers', () => {
  it('creates URL-safe verifiers and the RFC 7636 S256 challenge', async () => {
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCodeVerifier()).not.toBe(v);
    // Test vector from RFC 7636 appendix B.
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
