import { FREE_ACTIVE_JOB_LIMIT } from '@/domain/plan';
import { AccountService } from '@/services/account-service';
import {
  decodeState,
  encodeState,
  GOOGLE_REDIRECT_URI,
  sha256Hex,
} from '@/services/backend/google';
import { BackendError, randomToken, SupabaseClient } from '@/services/backend/supabase-client';
import { createServices } from '@/services/container';
import { JobLimitError } from '@/services/job-service';
import type { ExtractorRunner, WebAuthFlow } from '@/services/ports';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import {
  ACCOUNT_ENTITLEMENT_KEY,
  ACCOUNT_SESSION_KEY,
  ACCOUNT_SHARING_OPT_OUT_KEY,
} from '@/storage/keys';
import { fakeFetch, type FakeResponse, type RecordedCall } from '../helpers/fake-fetch';
import { makeJob, testContext } from '../helpers/factories';

const SB = 'https://ref.supabase.co';
const CONFIG = { url: SB, anonKey: 'anon-key', googleClientId: 'gcid.apps.googleusercontent.com' };
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
  // Plays Google and rolestash.com/auth/google/: returns the chromiumapp URL
  // with the ID token and the same state in the fragment.
  const flow = new FakeAuthFlow((url) => {
    const state = new URL(url).searchParams.get('state') ?? '';
    return `https://ext-id.chromiumapp.org/#id_token=google-id-token&state=${state}`;
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
      profile: {},
      needsName: false,
      hasPassword: false,
      twoStep: false,
      needsSecondStep: false,
    });
    expect(await account.onTrial()).toBe(false);
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
    expect(await account.onTrial()).toBe(true);
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

  it('signs in with Google via an ID token, returning through rolestash.com', async () => {
    let exchanged: { provider?: string; id_token?: string; nonce?: string } = {};
    const { account, flow, calls } = setup({
      [`POST ${SB}/auth/v1/token`]: (c) => {
        exchanged = c.body as typeof exchanged;
        return token('g1');
      },
    });
    await account.signInWithGoogle();
    const url = new URL(flow.launched[0] ?? '');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'gcid.apps.googleusercontent.com',
      response_type: 'id_token',
      redirect_uri: GOOGLE_REDIRECT_URI,
      scope: 'openid email profile',
    });
    // The state names this extension, so the forwarding page knows where to return.
    expect(decodeState(url.searchParams.get('state'))?.e).toBe('ext-id');
    // Supabase gets the raw nonce; Google got its SHA-256.
    expect(exchanged.provider).toBe('google');
    expect(exchanged.id_token).toBe('google-id-token');
    expect(await sha256Hex(exchanged.nonce ?? '')).toBe(url.searchParams.get('nonce'));
    expect(calls.find((c) => c.url.includes('grant_type=id_token'))).toBeDefined();
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
    // A build without a Google client ID never offers it, and doesn't ask the server.
    const silent = fakeFetch({});
    const bare = new AccountService(
      new MemoryKeyValueStore(),
      new SupabaseClient({ url: SB, anonKey: 'anon-key' }, silent.fetch),
      new FakeAuthFlow(() => ''),
    );
    expect(await bare.googleSignInAvailable()).toBe(false);
    expect(silent.calls).toHaveLength(0);
    await expect(bare.signInWithGoogle()).rejects.toBeInstanceOf(BackendError);
  });

  it('rejects a Google result that is tampered with, cancelled or empty', async () => {
    const attempt = async (respond: (state: string) => string) => {
      const { store } = setup();
      const client = new SupabaseClient(CONFIG, fakeFetch({}).fetch);
      const flow = new FakeAuthFlow((url) => respond(new URL(url).searchParams.get('state') ?? ''));
      const account = new AccountService(store, client, flow);
      const error = await account.signInWithGoogle().catch((e: unknown) => e);
      expect((await account.state()).signedIn).toBe(false);
      return error;
    };
    const forged = encodeState({ e: 'ext-id', s: 'someone-elses-attempt' });
    expect(
      await attempt(() => `https://ext-id.chromiumapp.org/#id_token=stolen&state=${forged}`),
    ).toBeInstanceOf(BackendError);
    expect(await attempt(() => 'https://ext-id.chromiumapp.org/#id_token=x')).toBeInstanceOf(
      BackendError,
    );
    expect(
      await attempt((st) => `https://ext-id.chromiumapp.org/#error=access_denied&state=${st}`),
    ).toMatchObject({ message: 'Sign-in was cancelled' });
    expect(await attempt((st) => `https://ext-id.chromiumapp.org/#state=${st}`)).toBeInstanceOf(
      BackendError,
    );
  });
});

describe('AccountService passwords (ADR-0036)', () => {
  const withPassword = (hasPassword: boolean): FakeResponse => ({
    status: 200,
    body: {
      access_token: 'p1',
      refresh_token: 'r-p1',
      expires_in: 3600,
      user: { ...USER, user_metadata: { has_password: hasPassword } },
    },
  });

  it('signs in with a password, and reports a wrong one without signing in', async () => {
    const { account, calls } = setup({
      [`POST ${SB}/auth/v1/token`]: (c) =>
        (c.body as { password: string }).password === 'copper lantern violin'
          ? withPassword(true)
          : { status: 400, body: { error_code: 'invalid_credentials' } },
    });
    await expect(account.signInWithPassword('jo@example.com', 'nope')).rejects.toMatchObject({
      code: 'invalid_login',
    });
    expect((await account.state()).signedIn).toBe(false);
    await account.signInWithPassword(' Jo@Example.com', 'copper lantern violin');
    expect(calls.findLast((c) => c.url.includes('grant_type=password'))?.body).toEqual({
      email: 'jo@example.com',
      password: 'copper lantern violin',
    });
    expect(await account.state()).toMatchObject({ signedIn: true, hasPassword: true });
  });

  it('adds a password to a signed-in account and remembers it has one', async () => {
    const { account, calls } = setup({
      [`PUT ${SB}/auth/v1/user`]: { status: 200, body: { id: 'u-1' } },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    expect((await account.state()).hasPassword).toBe(false);
    await account.setPassword('copper lantern violin');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers.Authorization).toBe('Bearer a1');
    expect(put?.body).toEqual({ password: 'copper lantern violin', data: { has_password: true } });
    expect((await account.state()).hasPassword).toBe(true);
  });

  it('maps the server refusing a password', async () => {
    const { account } = setup({
      [`PUT ${SB}/auth/v1/user`]: { status: 422, body: { error_code: 'same_password' } },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    await expect(account.setPassword('copper lantern violin')).rejects.toMatchObject({
      code: 'same_password',
    });
  });

  it('sends reset links to the web board, and resets with the link’s session', async () => {
    const { account, calls } = setup({
      [`POST ${SB}/auth/v1/recover`]: { status: 200, body: {} },
      [`PUT ${SB}/auth/v1/user`]: { status: 200, body: { id: 'u-1' } },
      [`POST ${SB}/auth/v1/logout`]: { status: 204, body: null },
    });
    await account.requestPasswordReset('Jo@Example.com');
    const recover = calls.find((c) => c.url.includes('/recover'));
    expect(recover?.body).toEqual({ email: 'jo@example.com' });
    expect(new URL(recover?.url ?? '').searchParams.get('redirect_to')).toBe(
      'https://rolestash.com/board/?reset=1',
    );

    await account.completePasswordReset('recovery-token', 'copper lantern violin');
    expect(calls.find((c) => c.method === 'PUT')?.headers.Authorization).toBe(
      'Bearer recovery-token',
    );
    const logout = calls.find((c) => c.url.includes('/logout'));
    expect(logout?.url).toContain('scope=global');
  });

  it('signs out everywhere, then here', async () => {
    const { account, calls } = setup({
      [`POST ${SB}/auth/v1/logout`]: { status: 204, body: null },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    await account.signOutEverywhere();
    expect(calls.find((c) => c.url.includes('/logout'))?.url).toContain('scope=global');
    expect((await account.state()).signedIn).toBe(false);
  });
});

describe('AccountService two-step sign-in (ADR-0036)', () => {
  const jwt = (aal: string) => `h.${btoa(JSON.stringify({ aal }))}.s`;
  const session = (aal: string, twoStep: boolean): FakeResponse => ({
    status: 200,
    body: {
      access_token: jwt(aal),
      refresh_token: `r-${aal}`,
      expires_in: 3600,
      user: { ...USER, factors: twoStep ? [{ status: 'verified', id: 'f1' }] : [] },
    },
  });
  const factors = (status: string) => ({
    status: 200,
    body: {
      ...USER,
      factors: [{ id: 'f1', status, factor_type: 'totp', friendly_name: 'Authenticator app' }],
    },
  });

  it('holds a sign-in until the authenticator code, and never uses it before', async () => {
    const { account, calls, store } = setup({
      [`POST ${SB}/auth/v1/token`]: session('aal1', true),
      [`GET ${SB}/auth/v1/user`]: factors('verified'),
      [`POST ${SB}/auth/v1/factors/f1/challenge`]: { status: 200, body: { id: 'c1' } },
      [`POST ${SB}/auth/v1/factors/f1/verify`]: (c) =>
        (c.body as { code: string }).code === '123456'
          ? session('aal2', true)
          : { status: 422, body: { error_code: 'mfa_verification_failed' } },
    });
    await account.signInWithPassword('jo@example.com', 'copper lantern violin');
    expect(await account.state()).toMatchObject({ signedIn: false, needsSecondStep: true });
    expect(calls.some((c) => c.url.includes('/rest/v1/'))).toBe(false);
    expect((await store.get(['account:session']))['account:session']).toBeUndefined();

    await expect(account.verifySecondStep('000000')).rejects.toMatchObject({
      code: 'invalid_totp',
    });
    await account.verifySecondStep('123 456');
    expect(await account.state()).toMatchObject({
      signedIn: true,
      needsSecondStep: false,
      twoStep: true,
    });
    expect(calls.findLast((c) => c.url.includes('/verify'))?.body).toEqual({
      challenge_id: 'c1',
      code: '123456',
    });
  });

  it('cancels a waiting sign-in', async () => {
    const { account } = setup({
      [`POST ${SB}/auth/v1/token`]: session('aal1', true),
      [`POST ${SB}/auth/v1/logout`]: { status: 204, body: null },
    });
    await account.signInWithPassword('jo@example.com', 'copper lantern violin');
    await account.cancelSecondStep();
    expect(await account.state()).toMatchObject({ signedIn: false, needsSecondStep: false });
  });

  it('adds an authenticator: clears a half-added one, then confirms with a code', async () => {
    const { account, calls } = setup({
      [`GET ${SB}/auth/v1/user`]: factors('unverified'),
      [`DELETE ${SB}/auth/v1/factors/f1`]: { status: 200, body: { id: 'f1' } },
      [`POST ${SB}/auth/v1/factors`]: {
        status: 200,
        body: {
          id: 'f2',
          totp: { uri: 'otpauth://totp/Rolestash:jo', secret: 'ABC', qr_code: '' },
        },
      },
      [`POST ${SB}/auth/v1/factors/f2/challenge`]: { status: 200, body: { id: 'c2' } },
      [`POST ${SB}/auth/v1/factors/f2/verify`]: session('aal2', true),
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    const started = await account.startAuthenticator();
    expect(started).toEqual({ id: 'f2', uri: 'otpauth://totp/Rolestash:jo', secret: 'ABC' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/factors'))?.body).toMatchObject({
      factor_type: 'totp',
      issuer: 'Rolestash',
    });
    await account.confirmAuthenticator('f2', '654321');
    expect(await account.state()).toMatchObject({ signedIn: true, twoStep: true });
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
    await expect(s.account.checkoutUrl('pro', 'month')).rejects.toMatchObject({
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
    expect(await s.account.checkoutUrl('pro', 'year')).toBe(
      'https://rolestash.com/pay/?_ptxn=year',
    );
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
    await expect(s.account.checkoutUrl('pro', 'month')).rejects.toMatchObject({
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

describe('token helpers', () => {
  it('makes URL-safe random tokens and standard SHA-256 hex digests', async () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('decodes only well-formed state values', () => {
    expect(decodeState(encodeState({ e: 'abc', s: 'xyz' }))).toEqual({ e: 'abc', s: 'xyz' });
    for (const bad of [null, '', 'not-base64!!', btoa('[]'), btoa('{"e":1,"s":"x"}')])
      expect(decodeState(bad)).toBeUndefined();
  });
});

describe('AccountService on the web board (ADR-0017)', () => {
  it('finishes a Google sign-in started by a web page', async () => {
    const { account, calls } = setup({ [`POST ${SB}/auth/v1/token`]: token('g1') });
    await account.completeGoogleSignIn('google-id-token', 'raw-nonce');
    expect(calls[0]?.body).toEqual({
      provider: 'google',
      id_token: 'google-id-token',
      nonce: 'raw-nonce',
    });
    expect((await account.state()).signedIn).toBe(true);
  });

  it('mints a handoff token when signed in, and signs another client in with it', async () => {
    const extension = setup({
      [`POST ${SB}/functions/v1/web-handoff`]: { status: 200, body: { tokenHash: 'hash-1' } },
    });
    await extension.account.verifyEmailCode('jo@example.com', '123456');
    const hash = await extension.account.webHandoffToken();
    expect(hash).toBe('hash-1');
    expect(extension.calls.at(-1)?.headers.Authorization).toBe('Bearer a1');

    const web = setup({
      [`POST ${SB}/auth/v1/verify`]: (c) =>
        (c.body as { token_hash?: string }).token_hash === 'hash-1'
          ? token('w1')
          : { status: 403, body: { error_code: 'otp_expired' } },
    });
    await web.account.signInWithHandoff('hash-1');
    expect(web.calls[0]?.body).toEqual({ type: 'magiclink', token_hash: 'hash-1' });
    expect(await web.account.state()).toMatchObject({ signedIn: true, email: 'jo@example.com' });
    await expect(web.account.signInWithHandoff('used')).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  it('cannot mint a handoff token when signed out or rejected', async () => {
    const { account } = setup({
      [`POST ${SB}/functions/v1/web-handoff`]: { status: 500, body: {} },
    });
    await expect(account.webHandoffToken()).rejects.toMatchObject({ code: 'session_expired' });
    await account.verifyEmailCode('jo@example.com', '123456');
    await expect(account.webHandoffToken()).rejects.toMatchObject({ code: 'server' });
  });
});

describe('AccountService profile and sharing choice (ADR-0022)', () => {
  const PICTURE = 'data:image/webp;base64,UklGRg==';

  it('opts out of shared learning at sign-in, retrying until the server has it', async () => {
    let online = false;
    const { account, store, calls } = setup({
      [`POST ${SB}/rest/v1/rpc/set_email_sharing`]: () =>
        online ? { status: 200, body: { ok: true } } : { status: 503, body: {} },
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
    });
    await account.chooseSharingAtSignIn(false);
    await account.verifyEmailCode('jo@example.com', '123456');
    // The server was down: the choice waits on this device.
    expect((await store.get([ACCOUNT_SHARING_OPT_OUT_KEY]))[ACCOUNT_SHARING_OPT_OUT_KEY]).toBe(
      true,
    );
    online = true;
    await account.refreshEntitlement();
    const sent = calls.filter((c) => c.url.endsWith('/rpc/set_email_sharing'));
    expect(sent.at(-1)?.body).toEqual({ p_on: false });
    expect(sent.at(-1)?.headers.Authorization).toBe('Bearer a1');
    expect(
      (await store.get([ACCOUNT_SHARING_OPT_OUT_KEY]))[ACCOUNT_SHARING_OPT_OUT_KEY],
    ).toBeUndefined();
  });

  it('leaves sharing alone when the default (on) is kept', async () => {
    const { account, calls } = setup({
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
    });
    await account.chooseSharingAtSignIn(true);
    await account.verifyEmailCode('jo@example.com', '123456');
    expect(calls.some((c) => c.url.includes('set_email_sharing'))).toBe(false);
  });

  it('reads, saves and caches the display name and picture', async () => {
    const { account, calls } = setup({
      [`GET ${SB}/rest/v1/account_profiles`]: {
        status: 200,
        body: [{ display_name: 'Jo', avatar: 'https://tracker.example/x.gif' }],
      },
      [`POST ${SB}/rest/v1/account_profiles`]: { status: 201, body: null },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    // A picture that isn't a safe inline image is dropped with the rest of that row.
    expect((await account.state()).profile).toEqual({});

    await account.saveProfile({ displayName: '  Jo Example ', avatar: PICTURE });
    const save = calls.find((c) => c.method === 'POST' && c.url.includes('account_profiles'));
    expect(save?.body).toMatchObject({
      user_id: USER.id,
      display_name: 'Jo Example',
      avatar: PICTURE,
    });
    expect(save?.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect((await account.state()).profile).toEqual({ displayName: 'Jo Example', avatar: PICTURE });
    await expect(account.saveProfile({ avatar: 'https://x.example/a.png' })).rejects.toThrow();

    await account.signOut().catch(() => undefined);
  });

  it('greets by first name: from Google, or a guess from the email', async () => {
    const google = setup({
      [`POST ${SB}/auth/v1/token`]: {
        status: 200,
        body: {
          access_token: 'g1',
          refresh_token: 'r-g1',
          expires_in: 3600,
          user: { ...USER, user_metadata: { full_name: 'Jo Example-Smith' } },
        },
      },
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
    });
    await google.account.signInWithGoogle();
    expect((await google.account.state()).firstName).toBe('Jo');

    const byEmail = setup({ [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] } });
    await byEmail.account.verifyEmailCode('jo@example.com', '123456');
    expect((await byEmail.account.state()).firstName).toBe('Jo');
    expect((await byEmail.account.state()).profile).toEqual({});
  });

  it('names the account from Google and saves it, so Paddle and other devices see it', async () => {
    const google = setup({
      [`POST ${SB}/auth/v1/token`]: {
        status: 200,
        body: {
          access_token: 'g1',
          refresh_token: 'r-g1',
          expires_in: 3600,
          user: { ...USER, user_metadata: { full_name: 'Jo Example-Smith' } },
        },
      },
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
      [`POST ${SB}/rest/v1/account_profiles`]: { status: 201, body: null },
      [`POST ${SB}/functions/v1/welcome`]: { status: 200, body: { sent: true } },
    });
    await google.account.signInWithGoogle();
    const save = google.calls.find(
      (c) => c.method === 'POST' && c.url.includes('account_profiles'),
    );
    expect(save?.body).toMatchObject({ display_name: 'Jo Example-Smith' });
    const state = await google.account.state();
    expect(state).toMatchObject({ name: 'Jo Example-Smith', firstName: 'Jo', needsName: false });
  });

  it('asks email-code accounts for their name once, and Skip stops asking', async () => {
    const { account, calls } = setup({
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
      [`POST ${SB}/rest/v1/account_profiles`]: { status: 201, body: null },
      [`POST ${SB}/functions/v1/welcome`]: { status: 200, body: { sent: true } },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    expect((await account.state()).needsName).toBe(true);
    await account.skipName();
    expect((await account.state()).needsName).toBe(false);

    await account.saveProfile({ avatar: PICTURE });
    await account.saveName('  Joanna Example ');
    const last = calls
      .filter((c) => c.method === 'POST' && c.url.includes('account_profiles'))
      .at(-1);
    // Saving the name keeps the picture.
    expect(last?.body).toMatchObject({ display_name: 'Joanna Example', avatar: PICTURE });
    expect(await account.state()).toMatchObject({ name: 'Joanna Example', firstName: 'Joanna' });
  });

  it('asks for the welcome email once per account on this device', async () => {
    const { account, calls } = setup({
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
      [`POST ${SB}/functions/v1/welcome`]: { status: 200, body: { sent: true } },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    await account.welcomeOnce();
    await account.welcomeOnce();
    const asks = calls.filter((c) => c.url.endsWith('/functions/v1/welcome'));
    expect(asks).toHaveLength(1);
    expect(asks[0]?.headers.Authorization).toBe('Bearer a1');
  });

  it('keeps asking for the welcome on later sign-ins if the server was unreachable', async () => {
    let up = false;
    const { account, calls } = setup({
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
      [`POST ${SB}/functions/v1/welcome`]: () =>
        up ? { status: 200, body: { sent: true } } : { status: 503, body: {} },
    });
    await account.verifyEmailCode('jo@example.com', '123456');
    up = true;
    await account.welcomeOnce();
    expect(calls.filter((c) => c.url.endsWith('/functions/v1/welcome'))).toHaveLength(2);
  });

  it('shows prices in the user’s currency, cached for a day, US prices if offline', async () => {
    let calls = 0;
    const { account, ctx } = setup({
      [`GET ${SB}/functions/v1/prices`]: () => {
        calls++;
        return calls > 2
          ? { status: 503, body: {} }
          : {
              status: 200,
              body: {
                currency: 'AUD',
                prices: {
                  pro: { month: 'A$17.99', quarter: 'A$44.00', year: 'A$149.00' },
                  advanced: { month: 'A$17.99', quarter: 'A$44.00', year: 'A$149.00' },
                },
              },
            };
      },
    });
    expect((await account.localPrices())?.prices.pro.month).toBe('A$17.99');
    await account.localPrices();
    expect(calls).toBe(1);
    ctx.advance(25 * 3_600_000);
    await account.localPrices();
    expect(calls).toBe(2);
    ctx.advance(25 * 3_600_000);
    // Paddle unreachable: the last known prices stay.
    expect((await account.localPrices())?.currency).toBe('AUD');
  });
});
