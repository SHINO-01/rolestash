import {
  handleLaunchList,
  readLaunchEnv,
  type LaunchDeps,
} from '../../../supabase/functions/_shared/launch-list.ts';
import { newsEmail, parseNews } from '../../../supabase/functions/_shared/launch-emails.ts';
import { fakeFetch } from '../helpers/fake-fetch';

const SB = 'https://ref.supabase.co';
const FN = `${SB}/functions/v1/launch-list`;
const SITE = 'https://rolestash.com';
const TOKEN = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const STORE = 'https://chromewebstore.google.com/detail/rolestash/abc';

const ENV = readLaunchEnv(
  (name) =>
    ({
      SUPABASE_URL: SB,
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      RESEND_API_KEY: 're_key',
      LAUNCH_ADMIN_SECRET: 'admin-secret',
    })[name],
);

function deps(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(routes);
  const d: LaunchDeps = { env: ENV, fetch: f.fetch };
  const sent = () =>
    f.calls
      .filter((c) => c.url.startsWith('https://api.resend.com/'))
      .flatMap((c): unknown[] => (Array.isArray(c.body) ? (c.body as unknown[]) : [c.body])) as {
      to: string[];
      subject: string;
      html: string;
      text: string;
      headers?: Record<string, string>;
    }[];
  return { deps: d, calls: f.calls, sent };
}

/** A form post as a browser sends it. happy-dom's Request drops the
 * forbidden Origin header, so it's attached afterwards. */
function form(fields: Record<string, string>, origin: string | null = SITE): Request {
  const req = new Request(FN, { method: 'POST', body: new URLSearchParams(fields) });
  if (origin) {
    const headers = new Headers(req.headers);
    headers.set('Origin', origin);
    Object.defineProperty(req, 'headers', { value: headers });
  }
  return req;
}

const location = (res: Response) => res.headers.get('Location');
const signupRoute = (send: boolean) => ({
  [`POST ${SB}/rest/v1/rpc/launch_signup`]: { status: 200, body: [{ send, token: TOKEN }] },
});
const resendOk = {
  'POST https://api.resend.com/emails': { status: 200, body: { id: 'em_1' } },
  'POST https://api.resend.com/emails/batch': { status: 200, body: { data: [] } },
};

describe('launch list: signing up', () => {
  it('stores the address and emails a confirmation link', async () => {
    const { deps: d, calls, sent } = deps({ ...signupRoute(true), ...resendOk });
    const res = await handleLaunchList(form({ email: ' Sam@Example.com ', plan: 'pro' }), d);
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${SITE}/notify/check-email/`);
    const rpc = calls.find((c) => c.url.endsWith('/rpc/launch_signup'))!;
    expect(rpc.body).toEqual({ p_email: 'sam@example.com', p_plan: 'pro' });
    expect(rpc.headers.Authorization).toBe('Bearer service');
    const [mail] = sent();
    expect(mail?.to).toEqual(['sam@example.com']);
    expect(mail?.subject).toMatch(/Confirm/);
    expect(mail?.html).toContain(`${FN}?confirm=${TOKEN}`);
    expect(mail?.text).toContain(`${FN}?confirm=${TOKEN}`);
    // Even before consent, one click removes the address.
    expect(mail?.headers?.['List-Unsubscribe']).toBe(`<${FN}?unsubscribe=${TOKEN}>`);
    expect(mail?.text).toContain('Not you? Remove this address now');
  });

  it('answers the same way without emailing when the database says not to', async () => {
    const { deps: d, sent } = deps(signupRoute(false));
    const res = await handleLaunchList(form({ email: 'sam@example.com' }), d);
    expect(location(res)).toBe(`${SITE}/notify/check-email/`);
    expect(sent()).toHaveLength(0);
  });

  it('accepts the www origin too', async () => {
    const { deps: d } = deps(signupRoute(false));
    const res = await handleLaunchList(form({ email: 'a@b.co' }, 'https://www.rolestash.com'), d);
    expect(res.status).toBe(303);
  });

  it('rejects posts from other sites or without an Origin', async () => {
    const { deps: d, calls } = deps({});
    expect((await handleLaunchList(form({ email: 'a@b.co' }, 'https://evil.test'), d)).status).toBe(
      403,
    );
    expect((await handleLaunchList(form({ email: 'a@b.co' }, null), d)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('quietly drops bot submissions that fill the hidden field', async () => {
    const { deps: d, calls } = deps({});
    const res = await handleLaunchList(form({ email: 'a@b.co', company: 'Spam Inc' }), d);
    expect(location(res)).toBe(`${SITE}/notify/check-email/`);
    expect(calls).toHaveLength(0);
  });

  it.each(['', 'not-an-email', 'a@b', 'a b@c.co', `${'x'.repeat(250)}@b.co`])(
    'sends %j back to the problem page',
    async (email) => {
      const { deps: d, calls } = deps({});
      const res = await handleLaunchList(form({ email }), d);
      expect(location(res)).toBe(`${SITE}/notify/problem/`);
      expect(calls).toHaveLength(0);
    },
  );

  it('shows the problem page when email delivery fails', async () => {
    const { deps: d } = deps({
      ...signupRoute(true),
      'POST https://api.resend.com/emails': { status: 500, body: {} },
    });
    const res = await handleLaunchList(form({ email: 'a@b.co' }), d);
    expect(location(res)).toBe(`${SITE}/notify/problem/`);
  });

  it('rejects other methods', async () => {
    const { deps: d } = deps({});
    expect((await handleLaunchList(new Request(FN), d)).status).toBe(405);
  });
});

describe('launch list: confirming', () => {
  const confirmRoute = (rows: unknown[]) => ({
    [`POST ${SB}/rest/v1/rpc/launch_confirm`]: { status: 200, body: rows },
  });

  it('confirms and sends a welcome email with a one-click unsubscribe', async () => {
    const { deps: d, sent } = deps({
      ...confirmRoute([{ email: 'sam@example.com', plan: 'advanced', newly: true }]),
      ...resendOk,
    });
    const res = await handleLaunchList(new Request(`${FN}?confirm=${TOKEN}`), d);
    expect(location(res)).toBe(`${SITE}/notify/confirmed/`);
    const [mail] = sent();
    expect(mail?.subject).toBe('You’re on the Rolestash list');
    expect(mail?.text).toContain('interested in Advanced');
    expect(mail?.html).toContain(`${FN}?unsubscribe=${TOKEN}`);
    expect(mail?.headers).toEqual({
      'List-Unsubscribe': `<${FN}?unsubscribe=${TOKEN}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('does not resend the welcome email on a second click', async () => {
    const { deps: d, sent } = deps(
      confirmRoute([{ email: 'sam@example.com', plan: null, newly: false }]),
    );
    const res = await handleLaunchList(new Request(`${FN}?confirm=${TOKEN}`), d);
    expect(location(res)).toBe(`${SITE}/notify/confirmed/`);
    expect(sent()).toHaveLength(0);
  });

  it('sends unknown or malformed tokens to the problem page', async () => {
    const { deps: d } = deps(confirmRoute([]));
    for (const token of [TOKEN, 'nope']) {
      const res = await handleLaunchList(new Request(`${FN}?confirm=${token}`), d);
      expect(location(res)).toBe(`${SITE}/notify/problem/`);
    }
  });

  it('shows the problem page when the database is down', async () => {
    const { deps: d } = deps({
      [`POST ${SB}/rest/v1/rpc/launch_confirm`]: { status: 503, body: {} },
    });
    const res = await handleLaunchList(new Request(`${FN}?confirm=${TOKEN}`), d);
    expect(location(res)).toBe(`${SITE}/notify/problem/`);
  });
});

describe('launch list: unsubscribing', () => {
  const route = { [`POST ${SB}/rest/v1/rpc/launch_unsubscribe`]: { status: 200, body: true } };

  it('deletes the address from a link and shows the unsubscribed page', async () => {
    const { deps: d, calls } = deps(route);
    const res = await handleLaunchList(new Request(`${FN}?unsubscribe=${TOKEN}`), d);
    expect(location(res)).toBe(`${SITE}/notify/unsubscribed/`);
    expect(calls[0]?.body).toEqual({ p_token: TOKEN });
  });

  it('supports RFC 8058 one-click unsubscribe from mail apps', async () => {
    const { deps: d, calls } = deps(route);
    const res = await handleLaunchList(
      new Request(`${FN}?unsubscribe=${TOKEN}`, {
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
      }),
      d,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('treats a malformed token as already unsubscribed', async () => {
    const { deps: d, calls } = deps({});
    const res = await handleLaunchList(new Request(`${FN}?unsubscribe=x`), d);
    expect(location(res)).toBe(`${SITE}/notify/unsubscribed/`);
    expect(calls).toHaveLength(0);
  });
});

describe('launch list: sending campaigns', () => {
  const recipients = Array.from({ length: 150 }, (_, i) => ({
    email: `u${String(i)}@example.com`,
    plan: i === 0 ? 'pro' : null,
    token: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  }));
  const routes = {
    [`GET ${SB}/rest/v1/launch_subscribers`]: { status: 200, body: recipients },
    [`POST ${SB}/rest/v1/rpc/launch_mark_sent`]: { status: 204, body: null },
    ...resendOk,
  };
  const send = (body: unknown, secret = 'admin-secret') =>
    new Request(`${FN}?send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const NEWS = [
    'Subject: Custom columns are here',
    'Button: See what’s new | https://rolestash.com/',
    '',
    'You can now add your own columns.',
    '',
    'Pro and Advanced',
    'have them today.',
  ].join('\n');

  it('needs the admin secret', async () => {
    const { deps: d, calls } = deps(routes);
    for (const secret of ['wrong', 'admin-secre', 'admin-secret-and-more']) {
      const res = await handleLaunchList(send({ campaign: 'launch', storeUrl: STORE }, secret), d);
      expect(res.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ campaign: 'Launch!', storeUrl: STORE }, 'invalid_campaign'],
    [{ campaign: 'launch', storeUrl: 'https://evil.test/' }, 'invalid_store_url'],
    [{ campaign: '2026-11-columns', source: 'no subject here' }, 'invalid_news'],
  ])('rejects %j', async (body, error) => {
    const { deps: d } = deps(routes);
    const res = await handleLaunchList(send(body), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it('counts recipients without sending on a dry run (the default)', async () => {
    const { deps: d, sent, calls } = deps(routes);
    const res = await handleLaunchList(send({ campaign: 'launch', storeUrl: STORE }), d);
    expect(await res.json()).toEqual({
      dryRun: true,
      recipients: 150,
      subject: 'Rolestash is live on the Chrome Web Store',
    });
    expect(sent()).toHaveLength(0);
    // Only confirmed addresses that haven't had this campaign yet.
    expect(decodeURIComponent(calls[0]?.url ?? '')).toContain(
      'confirmed_at=not.is.null&or=(last_campaign.is.null,last_campaign.neq.launch)',
    );
  });

  it('sends the launch in batches of 100, records each batch, and keeps the list', async () => {
    const { deps: d, sent, calls } = deps(routes);
    const res = await handleLaunchList(
      send({ campaign: 'launch', storeUrl: STORE, dryRun: false }),
      d,
    );
    expect(await res.json()).toEqual({ dryRun: false, sent: 150 });
    const batches = calls.filter((c) => c.url.endsWith('/emails/batch'));
    expect(batches.map((b) => (b.body as unknown[]).length)).toEqual([100, 50]);
    const [first, second] = sent();
    expect(first?.html).toContain(STORE);
    expect(first?.text).toContain('30-day free trial, no card needed');
    expect(second?.text).toContain('free for up to 15 active jobs');
    expect(first?.text).toContain('Unsubscribe in one click (no sign-in, no questions)');
    expect(first?.headers?.['List-Unsubscribe']).toContain(recipients[0]?.token);
    const marks = calls.filter((c) => c.url.endsWith('/rpc/launch_mark_sent'));
    expect(marks.map((m) => (m.body as { p_tokens: string[] }).p_tokens.length)).toEqual([100, 50]);
    expect(marks[0]?.body).toMatchObject({ p_campaign: 'launch' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('sends product news written as a small text file', async () => {
    const one = [recipients[0]];
    const { deps: d, sent } = deps({
      ...routes,
      [`GET ${SB}/rest/v1/launch_subscribers`]: { status: 200, body: one },
    });
    const res = await handleLaunchList(
      send({ campaign: '2026-11-columns', source: NEWS, dryRun: false }),
      d,
    );
    expect(await res.json()).toEqual({ dryRun: false, sent: 1 });
    const [mail] = sent();
    expect(mail?.subject).toBe('Custom columns are here');
    expect(mail?.text).toContain('Pro and Advanced have them today.');
    expect(mail?.html).toContain('See what’s new');
    expect(mail?.html).toContain('Unsubscribe in one click');
  });

  it('reports a failed send as a server error', async () => {
    const { deps: d } = deps({
      ...routes,
      'POST https://api.resend.com/emails/batch': { status: 429, body: {} },
    });
    const res = await handleLaunchList(
      send({ campaign: 'launch', storeUrl: STORE, dryRun: false }),
      d,
    );
    expect(res.status).toBe(500);
  });
});

describe('parseNews', () => {
  it('reads the subject, an optional https button and paragraphs', () => {
    expect(parseNews('Subject: Hi\n\nOne\ntwo.\n\nThree.')).toEqual({
      subject: 'Hi',
      paragraphs: ['One two.', 'Three.'],
    });
  });

  it.each([
    'Hello\n\nNo subject line.',
    'Subject: Only a subject',
    'Subject: Hi\nButton: Go | http://insecure.test\n\nBody.',
    'Subject: Hi\nButton: no url\n\nBody.',
  ])('rejects %j', (source) => {
    expect(parseNews(source)).toBeNull();
  });

  it('escapes whatever it is given', () => {
    const news = parseNews('Subject: <b>Hi</b>\n\n<script>x</script>');
    expect(news && newsEmail(news, 'https://u').html).not.toContain('<script>');
  });
});

describe('readLaunchEnv', () => {
  it('requires its secrets and defaults the site and sender', () => {
    expect(() => readLaunchEnv(() => undefined)).toThrow(/SUPABASE_URL/);
    expect(ENV.siteOrigins).toEqual(['https://rolestash.com', 'https://www.rolestash.com']);
    expect(ENV.from).toBe('Rolestash <noreply@rolestash.com>');
  });
});
