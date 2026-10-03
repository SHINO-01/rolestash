import {
  welcomeEmail,
  bugReportEmail,
  firstWord,
} from '../../../supabase/functions/_shared/account-emails.ts';
import { readEnv } from '../../../supabase/functions/_shared/env.ts';
import {
  handleBillingPortal,
  handleBugReport,
  handleWelcome,
  type Deps,
} from '../../../supabase/functions/_shared/handlers.ts';
import { fakeFetch, type RecordedCall } from '../helpers/fake-fetch';

const SB = 'https://ref.supabase.co';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'sam@example.com' };
const NOW = new Date('2026-10-04T00:00:00.000Z');
const RESEND = 'POST https://api.resend.com/emails';

const SECRETS: Record<string, string> = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  PADDLE_ENV: 'sandbox',
  PADDLE_API_KEY: 'pdl_key',
  PADDLE_WEBHOOK_SECRET: 'whsec',
  PADDLE_PRICE_PRO_MONTHLY: 'a',
  PADDLE_PRICE_PRO_QUARTERLY: 'b',
  PADDLE_PRICE_PRO_YEARLY: 'c',
  PADDLE_PRICE_ADVANCED_MONTHLY: 'd',
  PADDLE_PRICE_ADVANCED_QUARTERLY: 'e',
  PADDLE_PRICE_ADVANCED_YEARLY: 'f',
  RESEND_API_KEY: 're_key',
};

function deps(routes: Parameters<typeof fakeFetch>[0], secrets = SECRETS) {
  const f = fakeFetch({
    [`GET ${SB}/auth/v1/user`]: (call) =>
      call.headers.Authorization === 'Bearer good-token'
        ? { status: 200, body: USER }
        : { status: 401, body: {} },
    ...routes,
  });
  const d: Deps = { env: readEnv((n) => secrets[n]), fetch: f.fetch, now: () => NOW };
  return { deps: d, calls: f.calls };
}

const post = (body?: unknown, token: string | null = 'good-token', ip = '203.0.113.7') =>
  new Request('https://fn', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const sent = (calls: RecordedCall[]) => calls.filter((c) => `${c.method} ${c.url}` === RESEND);

describe('welcome email', () => {
  const profile = (row: Record<string, unknown> | null) => ({
    status: 200,
    body: row ? [row] : [],
  });

  it('is sent once, greeting the account by its first name', async () => {
    const { deps: d, calls } = deps({
      [`POST ${SB}/rest/v1/account_profiles`]: { status: 201, body: [] },
      [`PATCH ${SB}/rest/v1/account_profiles`]: { status: 200, body: [{ user_id: USER.id }] },
      [`GET ${SB}/rest/v1/account_profiles`]: profile({ display_name: 'Sam Taylor' }),
      [RESEND]: { status: 200, body: { id: 'em_1' } },
    });
    const res = await handleWelcome(post(), d);
    expect(await res.json()).toEqual({ sent: true });
    const [mail] = sent(calls);
    expect(mail?.body).toMatchObject({
      to: [USER.email],
      reply_to: 'support@rolestash.com',
      subject: 'Welcome to Rolestash, Sam',
    });
    // The claim only succeeds while welcome_sent_at is still empty.
    const claim = calls.find((c) => c.method === 'PATCH');
    expect(claim?.url).toContain('welcome_sent_at=is.null');
  });

  it('does nothing when it was already sent (another device got there first)', async () => {
    const { deps: d, calls } = deps({
      [`POST ${SB}/rest/v1/account_profiles`]: { status: 201, body: [] },
      [`PATCH ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
    });
    expect(await (await handleWelcome(post(), d)).json()).toEqual({ sent: false });
    expect(sent(calls)).toHaveLength(0);
  });

  it('releases the claim when the email fails, so the next sign-in retries', async () => {
    const { deps: d, calls } = deps({
      [`POST ${SB}/rest/v1/account_profiles`]: { status: 201, body: [] },
      [`PATCH ${SB}/rest/v1/account_profiles`]: (call) =>
        call.url.includes('is.null')
          ? { status: 200, body: [{ user_id: USER.id }] }
          : { status: 204, body: null },
      [`GET ${SB}/rest/v1/account_profiles`]: profile(null),
      [RESEND]: { status: 500, body: {} },
    });
    expect((await handleWelcome(post(), d)).status).toBe(500);
    const release = calls.filter((c) => c.method === 'PATCH').at(-1);
    expect(release?.body).toEqual({ welcome_sent_at: null });
  });

  it('needs a signed-in account and email settings', async () => {
    expect((await handleWelcome(post(undefined, 'bad'), deps({}).deps)).status).toBe(401);
    const noEmail = deps({}, { ...SECRETS, RESEND_API_KEY: '' });
    expect((await handleWelcome(post(), noEmail.deps)).status).toBe(503);
  });

  it('reads well with or without a name', () => {
    expect(welcomeEmail('  Mei   Lin ').subject).toBe('Welcome to Rolestash, Mei');
    expect(welcomeEmail(null).subject).toBe('Welcome to Rolestash');
    expect(welcomeEmail('<b>Eve</b>').html).not.toContain('<b>Eve');
    expect(welcomeEmail(null).text).toContain('Alt+J');
    expect(firstWord('42')).toBeUndefined();
  });
});

describe('bug reports', () => {
  const count = (n: number) => ({
    status: 200,
    body: [],
    headers: { 'Content-Range': `0-0/${String(n)}` },
  });
  const routes = (recent = 0) => ({
    [`GET ${SB}/rest/v1/bug_reports`]: count(recent),
    [`POST ${SB}/rest/v1/bug_reports`]: { status: 201, body: [{ id: 41 }] },
    [`DELETE ${SB}/rest/v1/bug_reports`]: { status: 204, body: null },
    [RESEND]: { status: 200, body: { id: 'em_2' } },
  });

  it('stores a report from anyone and emails support, replying to the reporter', async () => {
    const { deps: d, calls } = deps(routes());
    const res = await handleBugReport(
      post(
        {
          message: 'The salary came out empty on this page.',
          contactEmail: 'casey@example.com',
          context: {
            version: '0.4.1',
            where: 'popup',
            page: 'https://jobs.example/1',
            secret: 'x',
          },
        },
        null,
      ),
      d,
    );
    expect(await res.json()).toEqual({ id: 41 });
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('bug_reports'));
    expect(insert?.body).toMatchObject({
      user_id: null,
      contact_email: 'casey@example.com',
      context: { version: '0.4.1', where: 'popup', page: 'https://jobs.example/1' },
    });
    // Unknown context keys are dropped; the address is stored only as a keyed hash.
    expect(JSON.stringify(insert?.body)).not.toContain('secret');
    expect(JSON.stringify(insert?.body)).not.toContain('203.0.113.7');
    expect((insert?.body as { ip_hash: string }).ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent(calls)[0]?.body).toMatchObject({
      to: ['support@rolestash.com'],
      reply_to: 'casey@example.com',
      subject: 'Bug report #41: The salary came out empty on this page.',
    });
  });

  it('attaches the account when signed in, and uses its email to reply', async () => {
    const { deps: d, calls } = deps(routes());
    await handleBugReport(post({ message: 'Sync stopped' }), d);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('bug_reports'));
    expect(insert?.body).toMatchObject({ user_id: USER.id, contact_email: USER.email });
  });

  it('refuses empty, oversized or malformed reports', async () => {
    const { deps: d } = deps(routes());
    expect((await handleBugReport(post({ message: '   ' }), d)).status).toBe(400);
    expect((await handleBugReport(post({ message: 'x'.repeat(5001) }), d)).status).toBe(400);
    expect((await handleBugReport(post({ message: 'x', contactEmail: 'nope' }), d)).status).toBe(
      400,
    );
    const notJson = new Request('https://fn', { method: 'POST', body: '{' });
    expect((await handleBugReport(notJson, d)).status).toBe(400);
    expect((await handleBugReport(new Request('https://fn'), d)).status).toBe(405);
  });

  it('allows 5 reports an hour from one address', async () => {
    const { deps: d, calls } = deps(routes(5));
    expect((await handleBugReport(post({ message: 'again' }), d)).status).toBe(429);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('bug_reports'))).toBe(false);
  });

  it('keeps the report even if the email to support fails', async () => {
    const { deps: d } = deps({ ...routes(), [RESEND]: { status: 500, body: {} } });
    expect((await handleBugReport(post({ message: 'still stored' }), d)).status).toBe(200);
  });

  it('formats the support copy as plain text', () => {
    const email = bugReportEmail({
      id: 7,
      message: 'Line one\n<script>',
      contactEmail: null,
      signedIn: false,
      context: { version: '0.4.1' },
    });
    expect(email.text).toContain('(no address given)');
    expect(email.html).not.toContain('<script>');
  });
});

describe('billing portal and the account name', () => {
  const paying = {
    [`GET ${SB}/rest/v1/entitlements`]: {
      status: 200,
      body: [
        { status: 'active', provider_customer_id: 'ctm_01', provider_subscription_id: 'sub_01' },
      ],
    },
    'POST https://sandbox-api.paddle.com/customers/ctm_01/portal-sessions': {
      status: 201,
      body: { data: { urls: { general: { overview: 'https://portal' } } } },
    },
  };

  it('sends the account name to Paddle before opening the portal', async () => {
    const { deps: d, calls } = deps({
      ...paying,
      [`GET ${SB}/rest/v1/account_profiles`]: {
        status: 200,
        body: [{ display_name: 'Sam Taylor' }],
      },
      'PATCH https://sandbox-api.paddle.com/customers/ctm_01': {
        status: 200,
        body: { data: { id: 'ctm_01' } },
      },
    });
    expect(await (await handleBillingPortal(post(), d)).json()).toEqual({ url: 'https://portal' });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Sam Taylor' });
  });

  it('still opens the portal without a name, or if Paddle refuses the update', async () => {
    const noName = deps({
      ...paying,
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [] },
    });
    expect((await handleBillingPortal(post(), noName.deps)).status).toBe(200);
    expect(noName.calls.some((c) => c.method === 'PATCH')).toBe(false);
    const refused = deps({
      ...paying,
      [`GET ${SB}/rest/v1/account_profiles`]: { status: 200, body: [{ display_name: 'Sam' }] },
      'PATCH https://sandbox-api.paddle.com/customers/ctm_01': { status: 500, body: {} },
    });
    expect((await handleBillingPortal(post(), refused.deps)).status).toBe(200);
  });
});
