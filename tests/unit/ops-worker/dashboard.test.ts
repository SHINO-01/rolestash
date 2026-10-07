// @vitest-environment node
import { handle } from '../../../infra/ops-worker/src/app';
import { signForm, verifyForm } from '../../../infra/ops-worker/src/forms';
import { html } from '../../../infra/ops-worker/src/html';
import { runReferralJob } from '../../../infra/ops-worker/src/jobs';
import { plusOneMonth, sydneyEndOfDay } from '../../../infra/ops-worker/src/paddle-admin';
import type { Env } from '../../../infra/ops-worker/src/panels';

/**
 * The dashboard's pages and actions (ADR-0037). Access itself is tested in
 * access.test.ts; here a fake Access key signs every request.
 */

const NOW = new Date('2026-10-07T00:00:00Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);
const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-1';
const ORIGIN = 'https://operations.rolestash.com';
const SECRET = 'admin-secret-for-tests';
const SB = 'https://x.supabase.co';
const PADDLE = 'https://api.paddle.com';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const encJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

let token = '';
let jwk: JsonWebKey & { kid: string };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const unsigned = `${encJson({ alg: 'RS256', kid: 'k1' })}.${encJson({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: SECONDS + 600,
    nbf: SECONDS - 10,
    iat: SECONDS - 60,
    email: 'owner@example.com',
  })}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(unsigned),
    ),
  );
  token = `${unsigned}.${b64url(sig)}`;
});

const ENV: Env = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  OWNER_EMAILS: 'owner@example.com',
  SUPABASE_URL: SB,
  SUPABASE_PUBLISHABLE_KEY: 'sb_pub',
  OPS_ADMIN_SECRET: SECRET,
  OPS_STATS_SECRET: 'stats',
  PADDLE_API_KEY: 'pdl',
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Routes "METHOD url-without-query" (or an ops_admin action as "admin <action>") to a body. */
function backend(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init.method ?? 'GET').toUpperCase();
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url, method, body });
    if (url === `https://${TEAM}/cdn-cgi/access/certs`)
      return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })));
    const key = url.endsWith('/rest/v1/rpc/ops_admin')
      ? `admin ${String(body.p_action)}`
      : `${method} ${url.split('?')[0] ?? ''}`;
    if (!(key in routes))
      return Promise.resolve(new Response(JSON.stringify({ message: key }), { status: 404 }));
    const route = routes[key];
    const result =
      typeof route === 'function'
        ? (route as (b: Record<string, unknown>) => unknown)(body)
        : route;
    return Promise.resolve(
      result instanceof Response ? result.clone() : new Response(JSON.stringify({ data: result })),
    );
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

/** ops_admin answers are the bare JSON, Paddle's are { data }. */
const adminAnswer = (value: unknown) => new Response(JSON.stringify(value));

const get = (path: string, deps: { fetch: typeof fetch }, env = ENV) =>
  handle(new Request(`${ORIGIN}${path}`, { headers: { 'Cf-Access-Jwt-Assertion': token } }), env, {
    fetch: deps.fetch,
    now: NOW,
  });

const post = (
  fields: Record<string, string | string[]>,
  deps: { fetch: typeof fetch },
  headers: Record<string, string> = {},
) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) form.append(k, one);
  return handle(
    new Request(`${ORIGIN}/do`, {
      method: 'POST',
      body: form,
      headers: {
        'Cf-Access-Jwt-Assertion': token,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        ...headers,
      },
    }),
    ENV,
    { fetch: deps.fetch, now: NOW },
  );
};

const firstStep = async (action: string) => ({
  _action: action,
  _step: 'preview',
  _token: await signForm(SECRET, 'owner@example.com', NOW, { _action: action }),
});

/** The hidden fields of the confirmation form on a preview page. */
function confirmFields(page: string): Record<string, string> {
  const form = page.slice(page.search(/<form method="post" action="\/do" class="card stack">/));
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\s*\/?>/g))
    fields[m[1] ?? ''] = (m[2] ?? '')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");
  return fields;
}

describe('dashboard building blocks', () => {
  it('escapes everything that is not already HTML', () => {
    const name = '<script>alert(1)</script>';
    expect(
      html`<p title="${'"x"'}">${name}${html`<b>ok</b>`}${[1, 2]}${null}${{ a: 1 }}</p>`.value,
    ).toBe('<p title="&quot;x&quot;">&lt;script&gt;alert(1)&lt;/script&gt;<b>ok</b>12</p>');
  });

  it('signs forms for one person, one set of fields, for an hour', async () => {
    const t = await signForm(SECRET, 'Owner@Example.com', NOW, {
      _action: 'grant.give',
      email: 'a@b.co',
    });
    expect(
      await verifyForm(SECRET, 'owner@example.com', NOW, t, {
        email: 'a@b.co',
        _action: 'grant.give',
      }),
    ).toBe(true);
    expect(
      await verifyForm(SECRET, 'other@example.com', NOW, t, {
        _action: 'grant.give',
        email: 'a@b.co',
      }),
    ).toBe(false);
    expect(
      await verifyForm(SECRET, 'owner@example.com', NOW, t, {
        _action: 'grant.give',
        email: 'x@b.co',
      }),
    ).toBe(false);
    expect(
      await verifyForm('other', 'owner@example.com', NOW, t, {
        _action: 'grant.give',
        email: 'a@b.co',
      }),
    ).toBe(false);
    const later = new Date(NOW.getTime() + 3601_000);
    expect(
      await verifyForm(SECRET, 'owner@example.com', later, t, {
        _action: 'grant.give',
        email: 'a@b.co',
      }),
    ).toBe(false);
    expect(await verifyForm(SECRET, 'owner@example.com', NOW, 'nope', {})).toBe(false);
  });

  it('ends codes at the end of a Sydney day, and moves renewals by a month', () => {
    expect(sydneyEndOfDay('2027-01-31')).toBe('2027-01-31T12:59:59.000Z'); // AEDT
    expect(sydneyEndOfDay('2027-06-30')).toBe('2027-06-30T13:59:59.000Z'); // AEST
    expect(plusOneMonth('2026-11-15T03:00:00Z')).toBe('2026-12-15T03:00:00.000Z');
    expect(plusOneMonth('2027-01-31T03:00:00Z')).toBe('2027-02-28T03:00:00.000Z');
  });
});

describe('pages', () => {
  it('shows the overview: attention first, numbers, live panels, and one line for what is not set up', async () => {
    const { fetch } = backend({
      [`POST ${SB}/rest/v1/rpc/ops_stats`]: adminAnswer({
        accounts: 40,
        signups_7d: 5,
        trials_active: 6,
        paid: { advanced: 3, pro: 1 },
        past_due: 1,
        cancelling: 0,
        complimentary: 2,
        problem_reports_new: 0,
      }),
      'admin overview': adminAnswer({
        grants_active: 2,
        grants_pending: 1,
        grants_ending_14d: 0,
        referrals_enabled: true,
        referrals_pending: 3,
        referrals_awaiting_paddle: 1,
        referrals_rewarded_30d: 4,
        last_change: null,
      }),
      [`GET ${PADDLE}/subscriptions`]: { data: [], meta: { pagination: { estimated_total: 4 } } },
    });
    const res = await get('/', { fetch });
    const page = await res.text();
    expect(res.status).toBe(200);
    // Paddle's panel can't load here, so past due comes from the account counts, once.
    expect(page).toContain('1 subscription past due');
    expect(page).toContain('Revenue (Paddle): Couldn&#39;t load (HTTP 404 discounts).');
    expect(page).toContain('1 referral month waiting for Paddle');
    expect(page).toMatch(/<div class="n">4<\/div>\s*<div class="l">Paying<\/div>/);
    expect(page).toContain('Not set up: ');
    expect(page).toContain('aria-current="page"');
    expect(page).not.toMatch(/<script/i);
    expect(res.headers.get('Content-Security-Policy')).toContain("form-action 'self'");
  });

  it('lists grants with revoke buttons, and discount codes with their promo links', async () => {
    const { fetch } = backend({
      'admin grants.list': adminAnswer([
        {
          id: 1,
          email: 'dana@example.com',
          reason: 'tester',
          expires_at: '2027-01-31T12:59:59Z',
          note: 'Beta',
          granted_at: '2026-10-01T00:00:00Z',
          granted_by: 'owner@example.com',
          state: 'active',
          revoked_at: null,
          revoked_by: null,
          revoke_note: null,
        },
        {
          id: 2,
          email: 'ga…@gmail.com',
          reason: 'team',
          expires_at: null,
          note: null,
          granted_at: '2026-10-02T00:00:00Z',
          granted_by: 'owner@example.com',
          state: 'pending',
          revoked_at: null,
          revoked_by: null,
          revoke_note: null,
        },
      ]),
      [`GET ${PADDLE}/discounts`]: [
        {
          id: 'dsc_01aaaaaaaaaa',
          code: 'LAUNCH30',
          status: 'active',
          type: 'percentage',
          amount: '30',
          recur: false,
          times_used: 4,
          usage_limit: 200,
          restrict_to: null,
          created_at: '2026-10-05T00:00:00Z',
          custom_data: { app: 'rolestash', kind: 'code' },
        },
        {
          id: 'dsc_01bbbbbbbbbb',
          code: null,
          status: 'active',
          type: 'percentage',
          amount: '50',
          custom_data: { app: 'rolestash', kind: 'referral' },
          created_at: '2026-10-05T00:00:00Z',
        },
        {
          id: 'dsc_01cccccccccc',
          code: 'OLD10',
          status: 'archived',
          type: 'percentage',
          amount: '10',
          created_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    const grants = await (await get('/grants', { fetch })).text();
    expect(grants).toContain('dana@example.com');
    expect(grants).toContain('waiting for sign-up');
    expect(grants.match(/>Revoke</g)).toHaveLength(2);

    const discounts = await (await get('/discounts', { fetch })).text();
    expect(discounts).toContain('rolestash.com/pricing/?code=LAUNCH30');
    expect(discounts).toContain('4 / 200');
    expect(discounts).toContain('Ended or archived (1)');
    expect(discounts).not.toContain('dsc_01bbbbbbbbbb'); // the referral discount lives on Referrals
  });

  it("says why Paddle refused the key, in Paddle's own words", async () => {
    const forbidden = new Response(
      JSON.stringify({
        error: { code: 'forbidden', detail: 'You aren’t permitted to perform this request.' },
      }),
      { status: 403 },
    );
    const { fetch } = backend({ [`GET ${PADDLE}/discounts`]: forbidden });
    const page = await (await get('/discounts', { fetch })).text();
    expect(page).toContain('Paddle refused the API key (forbidden: You aren’t permitted');
    expect(page).toContain('live key');
  });

  it('asks for setup instead of failing when secrets are missing', async () => {
    const { fetch } = backend({});
    const env = { ...ENV, OPS_ADMIN_SECRET: undefined, PADDLE_API_KEY: undefined };
    for (const path of ['/grants', '/discounts', '/referrals', '/activity']) {
      const res = await get(path, { fetch }, env);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('Set up changes');
    }
  });

  it('shows a notice only when the dashboard signed it', async () => {
    const { fetch } = backend({ 'admin grants.list': adminAnswer([]) });
    const n = await signForm(SECRET, 'owner@example.com', NOW, { notice: 'Granted.' });
    expect(await (await get(`/grants?notice=Granted.&n=${n}`, { fetch })).text()).toContain(
      'Granted.',
    );
    expect(
      await (await get('/grants?notice=Send%20money%20to%20x', { fetch })).text(),
    ).not.toContain('Send money');
  });
});

describe('actions', () => {
  it('refuses posts from other origins, without a valid token, or for unknown actions', async () => {
    const { fetch, calls } = backend({});
    expect(
      (await post(await firstStep('grant.give'), { fetch }, { Origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await post(await firstStep('grant.give'), { fetch }, { 'Sec-Fetch-Site': 'cross-site' }))
        .status,
    ).toBe(403);
    expect(
      (await post({ ...(await firstStep('grant.give')), _token: '1.ab' }, { fetch })).status,
    ).toBe(403);
    expect(
      (await post({ ...(await firstStep('grant.give')), _action: 'drop.tables' }, { fetch }))
        .status,
    ).toBe(400);
    expect(
      calls.filter((c) => c.url.includes('supabase') || c.url.includes('paddle')),
    ).toHaveLength(0);
  });

  it('gives Pro in two steps: a preview of the exact effect, then a typed confirmation', async () => {
    const { fetch, calls } = backend({
      'admin grants.preview': adminAnswer({
        has_account: false,
        status: null,
        complimentary: null,
        active_grant: null,
      }),
      'admin grants.grant': adminAnswer({ outcome: 'pending' }),
    });
    const preview = await post(
      {
        ...(await firstStep('grant.give')),
        email: 'Dana@Example.com',
        reason: 'tester',
        until: '2027-01-31',
        note: 'Beta',
      },
      { fetch },
    );
    const page = await preview.text();
    expect(preview.status).toBe(200);
    expect(page).toContain('has no account yet');
    expect(page).toContain('from the moment this email first signs in');
    expect(page).toContain('Type <b>dana@example.com</b> to confirm');
    expect(calls.some((c) => (c.body as { p_action?: string }).p_action === 'grants.grant')).toBe(
      false,
    );

    const fields = confirmFields(page);
    expect(fields).toMatchObject({
      _action: 'grant.give',
      _step: 'apply',
      email: 'dana@example.com',
      until: '2027-01-31',
    });
    // A wrong typed email changes nothing.
    const wrong = await post({ ...fields, _typed: 'someone@else.com' }, { fetch });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('Type dana@example.com exactly');
    // Tampering with a confirmed field breaks the signature.
    expect(
      (
        await post(
          { ...fields, email: 'mallory@example.com', _typed: 'mallory@example.com' },
          { fetch },
        )
      ).status,
    ).toBe(403);

    const done = await post({ ...fields, _typed: 'DANA@example.com' }, { fetch });
    expect(done.status).toBe(303);
    expect(done.headers.get('Location')).toMatch(/^\/grants\?notice=Saved/);
    const grant = calls.find((c) => (c.body as { p_action?: string }).p_action === 'grants.grant');
    expect(grant?.body).toEqual({
      p_secret: SECRET,
      p_actor: 'owner@example.com',
      p_action: 'grants.grant',
      p_args: { email: 'dana@example.com', reason: 'tester', until: '2027-01-31', note: 'Beta' },
    });
  });

  it('checks the form before previewing', async () => {
    const { fetch } = backend({ 'admin grants.list': adminAnswer([]) });
    const res = await post(
      { ...(await firstStep('grant.give')), email: 'nope', reason: 'tester' },
      { fetch },
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Enter an email address.');
    const past = await post(
      {
        ...(await firstStep('grant.give')),
        email: 'a@b.co',
        reason: 'tester',
        until: '2026-01-01',
      },
      { fetch },
    );
    expect(await past.text()).toContain('The end date is in the past.');
  });

  it('creates a discount code in Paddle for the chosen prices, and logs it', async () => {
    const { fetch, calls } = backend({
      [`GET ${PADDLE}/discounts`]: [],
      [`GET ${PADDLE}/products`]: [{ id: 'pro_1', custom_data: { app: 'rolestash', tier: 'pro' } }],
      [`GET ${PADDLE}/prices`]: [
        { id: 'pri_m', billing_cycle: { interval: 'month', frequency: 1 } },
        { id: 'pri_q', billing_cycle: { interval: 'month', frequency: 3 } },
        { id: 'pri_y', billing_cycle: { interval: 'year', frequency: 1 } },
      ],
      [`POST ${PADDLE}/discounts`]: { id: 'dsc_01newnewnewn', code: 'LAUNCH30', status: 'active' },
      'admin audit.log': adminAnswer({ outcome: 'logged' }),
    });
    const preview = await post(
      {
        ...(await firstStep('code.create')),
        code: 'launch30',
        percent: '30',
        payments: 'first',
        intervals: ['month', 'year'],
        until: '2026-12-31',
        limit: '200',
      },
      { fetch },
    );
    const page = await preview.text();
    expect(page).toContain('live Paddle');
    expect(page).toContain('Monthly, Yearly');
    expect(page).toContain('https://rolestash.com/pricing/?code=LAUNCH30');
    const done = await post(confirmFields(page), { fetch });
    expect(done.status).toBe(303);
    const created = calls.find((c) => c.method === 'POST' && c.url === `${PADDLE}/discounts`);
    expect(created?.body).toMatchObject({
      type: 'percentage',
      amount: '30',
      code: 'LAUNCH30',
      enabled_for_checkout: true,
      recur: false,
      restrict_to: ['pri_m', 'pri_y'],
      expires_at: '2026-12-31T12:59:59.000Z',
      usage_limit: 200,
    });
    expect(
      calls.find((c) => (c.body as { p_action?: string }).p_action === 'audit.log')?.body,
    ).toMatchObject({
      p_args: { action: 'paddle.code.create', outcome: 'dsc_01newnewnewn' },
    });
  });

  it('refuses 100% codes and duplicates', async () => {
    const { fetch } = backend({
      [`GET ${PADDLE}/discounts`]: [{ id: 'dsc_01aaaaaaaaaa', code: 'LAUNCH30', status: 'active' }],
    });
    const free = await post(
      {
        ...(await firstStep('code.create')),
        code: 'FREE',
        percent: '100',
        payments: 'first',
        intervals: 'month',
      },
      { fetch },
    );
    expect(await free.text()).toContain('Complimentary access is a grant');
    const dup = await post(
      {
        ...(await firstStep('code.create')),
        code: 'launch30',
        percent: '30',
        payments: 'first',
        intervals: 'month',
      },
      { fetch },
    );
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain('LAUNCH30 already exists in Paddle.');
  });

  it("won't turn referrals on before the friends' discount exists", async () => {
    const { fetch } = backend({
      'admin referrals.summary': adminAnswer({
        settings: { referrals_enabled: false, referral_percent: 50 },
      }),
    });
    const res = await post({ ...(await firstStep('referrals.toggle')), on: '1' }, { fetch });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Create the referral discount first');
  });
});

describe('customer emails (ADR-0038)', () => {
  const SEND_ENV: Env = { ...ENV, RESEND_SEND_KEY: 're_send' };
  const RESEND = 'POST https://api.resend.com/emails/batch';
  const sendPost = (fields: Record<string, string | string[]>, f: typeof fetch) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) form.append(k, one);
    return handle(
      new Request(`${ORIGIN}/do`, {
        method: 'POST',
        body: form,
        headers: {
          'Cf-Access-Jwt-Assertion': token,
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
        },
      }),
      SEND_ENV,
      { fetch: f, now: NOW },
    );
  };
  const PRICES = {
    [`GET ${PADDLE}/products`]: [{ id: 'pro_1', custom_data: { app: 'rolestash', tier: 'pro' } }],
    [`GET ${PADDLE}/prices`]: [
      { id: 'pri_m', billing_cycle: { interval: 'month', frequency: 1 } },
      { id: 'pri_q', billing_cycle: { interval: 'month', frequency: 3 } },
      { id: 'pri_y', billing_cycle: { interval: 'year', frequency: 1 } },
    ],
  };
  interface Mail {
    to: string[];
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  }
  const mails = (calls: Call[]) =>
    calls
      .filter((c) => c.url === 'https://api.resend.com/emails/batch')
      .flatMap((c) => c.body as Mail[]);

  it('emails someone who was given Pro, without an opt-out (a service message)', async () => {
    const { fetch, calls } = backend({
      'admin grants.preview': adminAnswer({
        has_account: false,
        status: null,
        complimentary: null,
        active_grant: null,
      }),
      'admin grants.grant': adminAnswer({ outcome: 'pending' }),
      'admin audit.log': adminAnswer({ outcome: 'logged' }),
      [RESEND]: new Response('{"data":[{"id":"1"}]}'),
    });
    const preview = await sendPost(
      {
        ...(await firstStep('grant.give')),
        email: 'dana@example.com',
        reason: 'tester',
        until: '2027-01-31',
        notify: '1',
      },
      fetch,
    );
    const page = await preview.text();
    expect(page).toContain('Emails them');
    const done = await sendPost({ ...confirmFields(page), _typed: 'dana@example.com' }, fetch);
    expect(
      new URL(done.headers.get('Location') ?? '', ORIGIN).searchParams.get('notice'),
    ).toContain('We emailed them');
    const [mail] = mails(calls);
    expect(mail?.to).toEqual(['dana@example.com']);
    expect(mail?.subject).toContain('Rolestash Pro');
    expect(mail?.text).toContain('31 January 2027');
    expect(mail?.text).toContain('Add Rolestash to Chrome');
    expect(mail?.headers).toBeUndefined();
    const grant = calls.find((c) => (c.body as { p_action?: string }).p_action === 'grants.grant');
    expect((grant?.body as { p_args: Record<string, string> }).p_args).not.toHaveProperty('notify');
  });

  it('sends a targeted discount: a new code limited to the people emailed, each with an opt-out', async () => {
    const recipients = [
      { email: 'ann@example.com', token: '11111111-2222-4333-8444-555555555555' },
      { email: 'cal@example.com', token: '66666666-2222-4333-8444-555555555555' },
    ];
    const { fetch, calls } = backend({
      ...PRICES,
      'admin audience.count': adminAnswer({ count: 2, sample: ['an…@example.com'], unknown: 0 }),
      'admin audience.claim': adminAnswer(recipients),
      'admin audit.log': adminAnswer({ outcome: 'logged' }),
      [`POST ${PADDLE}/discounts`]: (b: Record<string, unknown>) => ({
        id: 'dsc_01targettarget',
        code: b.code,
        status: 'active',
        amount: b.amount,
        type: 'percentage',
        recur: false,
        restrict_to: b.restrict_to,
        expires_at: b.expires_at,
      }),
      [RESEND]: new Response('{"data":[]}'),
    });
    const preview = await sendPost(
      {
        ...(await firstStep('offer.targeted')),
        percent: '40',
        payments: 'first',
        days: '14',
        intervals: ['month', 'year'],
        segment: 'trial_ended',
        message: 'Thanks for trying Rolestash.',
      },
      fetch,
    );
    const page = await preview.text();
    expect(preview.status).toBe(200);
    expect(page).toContain('<b>2 people</b>');
    expect(page).toContain('Trial ended, never paid');
    expect(calls.some((c) => c.url === `${PADDLE}/discounts` && c.method === 'POST')).toBe(false);

    const done = await sendPost(confirmFields(page), fetch);
    expect(done.status).toBe(303);
    const created = calls.find((c) => c.method === 'POST' && c.url === `${PADDLE}/discounts`);
    expect(created?.body).toMatchObject({
      amount: '40',
      usage_limit: 2,
      restrict_to: ['pri_m', 'pri_y'],
      expires_at: '2026-10-21T12:59:59.000Z',
    });
    const code = (created?.body as { code: string }).code;
    expect(code).toMatch(/^FOR[A-HJ-NP-Z2-9]{6}$/);
    const sent = mails(calls);
    expect(sent.map((m) => m.to[0])).toEqual(['ann@example.com', 'cal@example.com']);
    expect(sent[0]?.subject).toBe('40% off Rolestash Pro, just for you');
    expect(sent[0]?.html).toContain(`https://rolestash.com/pricing/?code=${code}`);
    expect(sent[0]?.text).toContain('Thanks for trying Rolestash.');
    expect(sent[0]?.text).toContain('21 October 2026');
    expect(sent[1]?.headers?.['List-Unsubscribe']).toBe(
      `<${SB}/functions/v1/launch-list?optout=${recipients[1]?.token ?? ''}>`,
    );
    expect(sent[1]?.html).toContain('No more offers');
    expect(
      calls.find(
        (c) => (c.body as { p_args?: { action?: string } }).p_args?.action === 'email.targeted',
      )?.body,
    ).toMatchObject({ p_args: { outcome: '2 sent' } });
  });

  it('refuses an offer nobody can get, and checks listed emails', async () => {
    const { fetch } = backend({
      'admin audience.count': adminAnswer({ count: 0, sample: [], unknown: 1 }),
      'admin emails.summary': adminAnswer({ opted_out: 0, emailed_7d: 0, recent: [] }),
      'admin referrals.summary': adminAnswer({ settings: { referrals_enabled: true } }),
    });
    const bad = await sendPost(
      {
        ...(await firstStep('offer.referrals')),
        segment: 'listed',
        emails: 'ann@example.com, nope',
      },
      fetch,
    );
    expect(await bad.text()).toContain('nope isn&#39;t an email address.');
    const none = await sendPost(
      { ...(await firstStep('offer.referrals')), segment: 'listed', emails: 'zed@example.com' },
      fetch,
    );
    expect(none.status).toBe(400);
    expect(await none.text()).toContain('Nobody in that audience');
  });

  it('turns referrals on and announces them by email', async () => {
    const { fetch, calls } = backend({
      'admin referrals.summary': adminAnswer({
        settings: { referral_discount_id: 'dsc_01abcdefghijk', referral_percent: 50 },
      }),
      'admin settings.set': adminAnswer({ outcome: 'saved' }),
      'admin audience.count': adminAnswer({ count: 1, sample: [], unknown: 0 }),
      'admin audience.claim': adminAnswer([
        { email: 'tom@example.com', token: '11111111-2222-4333-8444-555555555555' },
      ]),
      'admin audit.log': adminAnswer({ outcome: 'logged' }),
      [RESEND]: new Response('{"data":[]}'),
    });
    const preview = await sendPost(
      { ...(await firstStep('referrals.toggle')), on: '1', segment: 'everyone' },
      fetch,
    );
    const page = await preview.text();
    expect(page).toContain('Then announces it by email.');
    const done = await sendPost(confirmFields(page), fetch);
    expect(
      new URL(done.headers.get('Location') ?? '', ORIGIN).searchParams.get('notice'),
    ).toContain('1 email sent');
    expect(mails(calls)[0]?.subject).toContain('Invite friends');
    expect(mails(calls)[0]?.text).toContain('50% off their first month');
  });

  it('shows the Emails page, and asks for the sending key when it is missing', async () => {
    const { fetch } = backend({
      'admin emails.summary': adminAnswer({
        opted_out: 3,
        emailed_7d: 12,
        recent: [
          {
            at: '2026-10-06T00:00:00Z',
            actor: 'owner@example.com',
            action: 'email.code',
            detail: { code: 'LAUNCH30', segment: 'free' },
            outcome: '12 sent',
          },
        ],
      }),
      [`GET ${PADDLE}/discounts`]: [],
    });
    const res = await get('/emails', { fetch });
    const page = await res.text();
    expect(res.status).toBe(200);
    expect(page).toContain('Send a targeted discount');
    expect(page).toContain('Opted out of offers');
    expect(page).toContain('LAUNCH30');
    expect(page).toContain('RESEND_SEND_KEY');
  });
});

describe('the daily referral job', () => {
  it("moves paying referrers' renewals in Paddle, and falls back to a grant", async () => {
    const { fetch, calls } = backend({
      'admin referrals.process': adminAnswer({
        qualified: 2,
        granted: 0,
        awaiting_paddle: 2,
        capped: 0,
      }),
      'admin referrals.paddle_due': adminAnswer([
        { id: 7, subscription_id: 'sub_live' },
        { id: 8, subscription_id: 'sub_gone' },
      ]),
      [`GET ${PADDLE}/subscriptions/sub_live`]: {
        status: 'active',
        next_billed_at: '2026-11-15T03:00:00Z',
        scheduled_change: null,
      },
      [`PATCH ${PADDLE}/subscriptions/sub_live`]: { id: 'sub_live' },
      [`GET ${PADDLE}/subscriptions/sub_gone`]: { status: 'canceled', next_billed_at: null },
      'admin referrals.paddle_done': adminAnswer({ outcome: 'rewarded' }),
    });
    const summary = await runReferralJob(ENV, { fetch, now: NOW }, 'daily job');
    expect(summary).toEqual({
      qualified: 2,
      granted: 0,
      paddleMoved: 1,
      paddleFallback: 1,
      failed: 0,
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      next_billed_at: '2026-12-15T03:00:00.000Z',
      proration_billing_mode: 'do_not_bill',
    });
    const done = calls.filter(
      (c) => (c.body as { p_action?: string }).p_action === 'referrals.paddle_done',
    );
    expect(done.map((c) => (c.body as { p_args: { ok: boolean } }).p_args.ok)).toEqual([
      true,
      false,
    ]);
    expect(done.every((c) => (c.body as { p_actor: string }).p_actor === 'daily job')).toBe(true);
  });
});
