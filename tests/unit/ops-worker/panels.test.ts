import {
  accountsPanel,
  cloudflarePanel,
  formatTotals,
  githubPanel,
  paddlePanel,
  resendPanel,
  safely,
  searchPanel,
} from '../../../infra/ops-worker/src/panels';

const NOW = new Date('2026-10-05T00:00:00Z');
type Route = (url: string, init?: RequestInit) => unknown;

function fakeFetch(route: Route, seen: { url: string; init?: RequestInit }[] = []) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    seen.push({ url, init });
    const body = route(url, init);
    return Promise.resolve(
      body instanceof Response ? body : new Response(JSON.stringify(body ?? {}), { status: 200 }),
    );
  }) as typeof fetch;
}

describe('ops panels', () => {
  it('says "not set up" without tokens', async () => {
    const deps = { fetch: fakeFetch(() => ({})), now: NOW };
    for (const panel of [
      await paddlePanel({}, deps),
      await cloudflarePanel({}, deps),
      await githubPanel({}, deps),
      await resendPanel({}, deps),
      await searchPanel({}, deps),
      await accountsPanel({}, deps),
    ])
      expect(panel.status).toBe('not_configured');
  });

  it('turns failures into a safe message, never echoing secrets', async () => {
    const panel = await safely('X', () =>
      Promise.reject(new Error('token sk_live_secret rejected')),
    );
    expect(panel).toMatchObject({ status: 'error', note: "Couldn't load (failed)." });
    const http = await safely('X', () => Promise.reject(new Error('HTTP 401')));
    expect(http.note).toBe("Couldn't load (HTTP 401).");
  });

  it('formats sales per currency', () => {
    expect(formatTotals(new Map())).toBe('0');
    expect(
      formatTotals(
        new Map([
          ['USD', 700],
          ['AUD', 2299],
        ]),
      ),
    ).toBe('AUD 22.99 · USD 7.00');
  });

  it('summarises Paddle with a read-only key, flagging chargebacks', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/transactions'))
        return {
          data: [
            { currency_code: 'USD', details: { totals: { grand_total: '700' } } },
            { currency_code: 'USD', details: { totals: { grand_total: '1500' } } },
          ],
        };
      if (url.includes('action=chargeback'))
        return { data: [{ created_at: '2026-10-01T00:00:00Z' }] };
      if (url.includes('action=refund'))
        return {
          data: [{ created_at: '2026-10-02T00:00:00Z' }, { created_at: '2026-01-01T00:00:00Z' }],
        };
      if (url.includes('status=past_due')) return { meta: { pagination: { estimated_total: 0 } } };
      return { meta: { pagination: { estimated_total: 4 } } };
    }, seen);
    const panel = await paddlePanel({ PADDLE_API_KEY: 'pdl_key' }, { fetch: fetchFn, now: NOW });
    expect(panel.status).toBe('attention');
    expect(Object.fromEntries(panel.rows)).toMatchObject({
      'Active subscriptions': '4',
      'Past due': '0',
      'Sales, last 7 days': '2 · USD 22.00',
      'Refunds, last 30 days': '1',
      'Chargebacks, last 30 days': '1',
    });
    // Only GET requests: the dashboard never changes anything in Paddle.
    expect(seen.every(({ init }) => (init?.method ?? 'GET') === 'GET')).toBe(true);
    expect(JSON.stringify(panel)).not.toContain('pdl_key');
  });

  it('sums Cloudflare edge counts and flags a high error rate', async () => {
    const day = (requests: number, errors: number) => ({
      sum: {
        requests,
        threats: 1,
        responseStatusMap: [
          { edgeResponseStatus: 200, requests: requests - errors },
          { edgeResponseStatus: 502, requests: errors },
        ],
      },
    });
    const fetchFn = fakeFetch(() => ({
      data: { viewer: { zones: [{ httpRequests1dGroups: [day(1000, 5), day(1000, 45)] }] } },
    }));
    const panel = await cloudflarePanel(
      { CF_ANALYTICS_TOKEN: 't', CF_ZONE_ID: 'z' },
      { fetch: fetchFn, now: NOW },
    );
    expect(panel.status).toBe('attention');
    expect(panel.rows[1]).toEqual(['Server errors (5xx)', '50 (2.50%)']);
  });

  it('reports CI and release runs and Dependabot alerts', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('dependabot')) return [];
      if (url.includes('release.yml'))
        return { workflow_runs: [{ status: 'completed', conclusion: 'success' }] };
      return { workflow_runs: [{ status: 'completed', conclusion: 'failure' }] };
    });
    const panel = await githubPanel(
      { GITHUB_TOKEN: 'g', GITHUB_REPOS: 'o/app,o/release' },
      { fetch: fetchFn, now: NOW },
    );
    expect(panel.status).toBe('attention');
    expect(panel.rows).toEqual([
      ['app: ci.yml', 'failure'],
      ['release: release.yml', 'success'],
      ['Open Dependabot alerts', '0'],
    ]);
  });

  it('counts recent bounces and spam reports from Resend', async () => {
    const fetchFn = fakeFetch((url) =>
      url.endsWith('/domains')
        ? { data: [{ name: 'rolestash.com', status: 'verified' }] }
        : {
            data: [
              { created_at: '2026-10-04T00:00:00Z', last_event: 'delivered' },
              { created_at: '2026-10-03T00:00:00Z', last_event: 'bounced' },
              { created_at: '2026-09-01T00:00:00Z', last_event: 'complained' },
            ],
          },
    );
    const panel = await resendPanel({ RESEND_API_KEY: 'r' }, { fetch: fetchFn, now: NOW });
    expect(panel.status).toBe('attention');
    expect(Object.fromEntries(panel.rows)).toMatchObject({
      'Domain rolestash.com': 'verified',
      'Sent, last 7 days (latest 100)': '2',
      Bounced: '1',
      'Marked as spam': '0',
    });
  });

  it('reads Search Console with a service account', async () => {
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
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchFn = fakeFetch((url, init) => {
      if (url.includes('oauth2')) return { access_token: 'ya29' };
      if (url.endsWith('/sitemaps')) return { sitemap: [{ path: 'x', errors: '0' }] };
      return (typeof init?.body === 'string' ? init.body : '').includes('dimensions')
        ? { rows: [{ keys: ['job tracker'], clicks: 3, impressions: 40 }] }
        : { rows: [{ clicks: 9, impressions: 120 }] };
    }, seen);
    const panel = await searchPanel(
      {
        GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'ops@x.iam', private_key: pem }),
        SEARCH_CONSOLE_SITE: 'sc-domain:rolestash.com',
      },
      { fetch: fetchFn, now: NOW },
    );
    expect(panel.status).toBe('ok');
    expect(panel.rows[0]).toEqual(['Clicks, last 28 days', '9']);
    expect(panel.rows).toContainEqual(['“job tracker”', '3 clicks · 40 views']);
    // The token request asks only for the read-only Search Console scope.
    const assertion =
      new URLSearchParams(typeof seen[0]?.init?.body === 'string' ? seen[0].init.body : '').get(
        'assertion',
      ) ?? '';
    const claims = JSON.parse(
      atob((assertion.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')),
    ) as { scope: string };
    expect(claims.scope).toBe('https://www.googleapis.com/auth/webmasters.readonly');
  });

  it('reads account counts with the publishable key and its own secret', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchFn = fakeFetch(
      () => ({
        accounts: 12,
        signups_7d: 3,
        trials_active: 4,
        paid: { pro: 2, advanced: 1 },
        past_due: 0,
        cancelling: 1,
        complimentary: 1,
        devices_active_7d: 9,
        email_inboxes: 1,
        news_subscribers: 20,
        problem_reports_new: 1,
        problem_reports_7d: 2,
      }),
      seen,
    );
    const panel = await accountsPanel(
      {
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_pub',
        OPS_STATS_SECRET: 's3cret',
      },
      { fetch: fetchFn, now: NOW },
    );
    expect(seen[0]?.url).toBe('https://x.supabase.co/rest/v1/rpc/ops_stats');
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ p_secret: 's3cret' }));
    expect(panel.status).toBe('attention'); // a new problem report
    // Accounts, paying and trials are the overview's headline numbers; this panel is usage.
    expect(Object.fromEntries(panel.rows)).toEqual({
      'Devices syncing this week': '9',
      'Email update inboxes': '1',
      'Product news subscribers': '20',
      'Problem reports: new / this week': '1 / 2',
    });
    expect(JSON.stringify(panel)).not.toContain('s3cret');
  });
});
