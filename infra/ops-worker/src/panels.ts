/**
 * The dashboard's panels (ADR-0026). Each reads one provider with a
 * read-only token and returns counts and statuses, never customer details.
 * A panel without its token says "Not set up"; a failing one says so, and
 * the rest of the page still renders. Errors never include secrets.
 */

export interface Env {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Secret: comma-separated emails allowed in. */
  OWNER_EMAILS?: string;
  CF_ZONE_ID?: string;
  GITHUB_REPOS?: string;
  SEARCH_CONSOLE_SITE?: string;
  /** Secrets, each read-only (see the ADR for exact scopes). */
  PADDLE_API_KEY?: string;
  CF_ANALYTICS_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GOOGLE_SERVICE_ACCOUNT?: string;
  RESEND_API_KEY?: string;
}

export type PanelStatus = 'ok' | 'attention' | 'not_configured' | 'error';

export interface Panel {
  title: string;
  status: PanelStatus;
  rows: [label: string, value: string][];
  /** Where to look closer (the provider's own dashboard). */
  link?: { label: string; href: string };
  note?: string;
}

export interface Deps {
  fetch: typeof fetch;
  now: Date;
}

const DAY_MS = 86_400_000;
const TIMEOUT_MS = 8_000;

export const isoDaysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS).toISOString();

async function getJson(
  deps: Deps,
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return (await response.json()) as Record<string, unknown>;
}

/** Runs a panel; turns any failure into an error panel with a safe message. */
export async function safely(title: string, run: () => Promise<Panel>): Promise<Panel> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed';
    // Only our own short messages ("HTTP 401", "timeout") reach the page.
    const safe = /^HTTP \d{3}$/.test(message)
      ? message
      : error instanceof Error && error.name === 'TimeoutError'
        ? 'timed out'
        : 'failed';
    return { title, status: 'error', rows: [], note: `Couldn't load (${safe}).` };
  }
}

const notConfigured = (title: string, what: string): Panel => ({
  title,
  status: 'not_configured',
  rows: [],
  note: `Not set up: add ${what} (ADR-0026).`,
});

/** "AUD 123.40 · USD 7.00", from amounts in the lowest unit per currency. */
export function formatTotals(totals: Map<string, number>): string {
  if (totals.size === 0) return '0';
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => `${currency} ${(minor / 100).toFixed(2)}`)
    .join(' · ');
}

// ---------------------------------------------------------------- Paddle

export async function paddlePanel(env: Env, deps: Deps): Promise<Panel> {
  const title = 'Revenue (Paddle)';
  const key = env.PADDLE_API_KEY;
  if (!key) return notConfigured(title, 'PADDLE_API_KEY (read-only)');
  const base = 'https://api.paddle.com';
  const auth = { headers: { Authorization: `Bearer ${key}` } };
  const total = (body: Record<string, unknown>) =>
    String(
      (body.meta as { pagination?: { estimated_total?: number } } | undefined)?.pagination
        ?.estimated_total ?? 0,
    );

  const since7 = isoDaysAgo(deps.now, 7);
  const since30 = isoDaysAgo(deps.now, 30);
  const [active, pastDue, cancelling, discounts, transactions, refunds, chargebacks] =
    await Promise.all([
      getJson(deps, `${base}/subscriptions?status=active&per_page=1`, auth),
      getJson(deps, `${base}/subscriptions?status=past_due&per_page=1`, auth),
      getJson(
        deps,
        `${base}/subscriptions?status=active&scheduled_change_action=cancel&per_page=1`,
        auth,
      ),
      getJson(deps, `${base}/discounts?status=active&per_page=1`, auth),
      getJson(
        deps,
        `${base}/transactions?status=completed&billed_at[GTE]=${encodeURIComponent(since7)}&per_page=200`,
        auth,
      ),
      getJson(deps, `${base}/adjustments?action=refund&per_page=200`, auth),
      getJson(deps, `${base}/adjustments?action=chargeback&per_page=200`, auth),
    ]);

  const sales = new Map<string, number>();
  const txList = (transactions.data as Record<string, unknown>[] | undefined) ?? [];
  for (const t of txList) {
    const currency = typeof t.currency_code === 'string' ? t.currency_code : '';
    const amount = Number(
      (t.details as { totals?: { grand_total?: string } } | undefined)?.totals?.grand_total ?? 0,
    );
    if (currency) sales.set(currency, (sales.get(currency) ?? 0) + amount);
  }
  const recent = (body: Record<string, unknown>) =>
    ((body.data as { created_at?: string }[] | undefined) ?? []).filter(
      (a) => (a.created_at ?? '') >= since30,
    ).length;
  const refundCount = recent(refunds);
  const chargebackCount = recent(chargebacks);

  return {
    title,
    status: Number(total(pastDue)) > 0 || chargebackCount > 0 ? 'attention' : 'ok',
    rows: [
      ['Active subscriptions', total(active)],
      ['Cancelling at period end', total(cancelling)],
      ['Past due', total(pastDue)],
      ['Sales, last 7 days', `${String(txList.length)} · ${formatTotals(sales)}`],
      ['Refunds, last 30 days', String(refundCount)],
      ['Chargebacks, last 30 days', String(chargebackCount)],
      ['Active discounts', total(discounts)],
    ],
    link: { label: 'Open Paddle', href: 'https://vendors.paddle.com/' },
  };
}

// ---------------------------------------------------------------- Cloudflare

export async function cloudflarePanel(env: Env, deps: Deps): Promise<Panel> {
  const title = 'Site (Cloudflare)';
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID)
    return notConfigured(title, 'CF_ANALYTICS_TOKEN (Zone Analytics: Read)');
  const query = `query($zone: String!, $since: Date!) { viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1dGroups(limit: 7, filter: { date_geq: $since }, orderBy: [date_ASC]) {
      sum { requests threats responseStatusMap { edgeResponseStatus requests } } } } } }`;
  const body = await getJson(deps, 'https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { zone: env.CF_ZONE_ID, since: isoDaysAgo(deps.now, 6).slice(0, 10) },
    }),
  });
  if (Array.isArray(body.errors) && body.errors.length > 0) throw new Error('HTTP 400');
  interface Day {
    sum: {
      requests: number;
      threats: number;
      responseStatusMap: { edgeResponseStatus: number; requests: number }[];
    };
  }
  const days =
    (body.data as { viewer?: { zones?: { httpRequests1dGroups?: Day[] }[] } } | undefined)?.viewer
      ?.zones?.[0]?.httpRequests1dGroups ?? [];
  let requests = 0;
  let threats = 0;
  let errors = 0;
  for (const d of days) {
    requests += d.sum.requests;
    threats += d.sum.threats;
    for (const s of d.sum.responseStatusMap) if (s.edgeResponseStatus >= 500) errors += s.requests;
  }
  const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
  return {
    title,
    status: errorRate > 1 ? 'attention' : 'ok',
    rows: [
      ['Requests, last 7 days', requests.toLocaleString('en-AU')],
      ['Server errors (5xx)', `${errors.toLocaleString('en-AU')} (${errorRate.toFixed(2)}%)`],
      ['Threats blocked', threats.toLocaleString('en-AU')],
    ],
    link: { label: 'Open Cloudflare', href: 'https://dash.cloudflare.com/' },
    note: 'Edge request counts Cloudflare keeps anyway; the site adds no analytics.',
  };
}

// ---------------------------------------------------------------- GitHub

export async function githubPanel(env: Env, deps: Deps): Promise<Panel> {
  const title = 'Product health (GitHub)';
  if (!env.GITHUB_TOKEN) return notConfigured(title, 'GITHUB_TOKEN (read-only)');
  const repos = (env.GITHUB_REPOS ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const auth = {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rolestash-ops',
    },
  };
  const rows: [string, string][] = [];
  let attention = false;
  for (const [repo, workflow, branch] of [
    [repos[0], 'ci.yml', 'dev'],
    [repos[1], 'release.yml', ''],
  ] as const) {
    if (!repo) continue;
    const runs = await getJson(
      deps,
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1${branch ? `&branch=${branch}` : ''}`,
      auth,
    );
    const run = (runs.workflow_runs as { status?: string; conclusion?: string | null }[])[0];
    const state = run ? (run.conclusion ?? run.status ?? 'unknown') : 'none';
    if (state === 'failure') attention = true;
    rows.push([`${repo.split('/')[1] ?? repo}: ${workflow}`, state]);
  }
  if (repos[0]) {
    const response = await deps.fetch(
      `https://api.github.com/repos/${repos[0]}/dependabot/alerts?state=open&per_page=100`,
      { ...auth, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (response.ok) {
      const alerts = (await response.json()) as unknown[];
      if (alerts.length > 0) attention = true;
      rows.push(['Open Dependabot alerts', String(alerts.length)]);
    }
  }
  return {
    title,
    status: attention ? 'attention' : 'ok',
    rows,
    ...(repos[0]
      ? { link: { label: 'Open GitHub', href: `https://github.com/${repos[0]}/actions` } }
      : {}),
  };
}

// ---------------------------------------------------------------- Resend

export async function resendPanel(env: Env, deps: Deps): Promise<Panel> {
  const title = 'Email (Resend)';
  if (!env.RESEND_API_KEY) return notConfigured(title, 'RESEND_API_KEY');
  const auth = { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } };
  const [domains, emails] = await Promise.all([
    getJson(deps, 'https://api.resend.com/domains', auth),
    getJson(deps, 'https://api.resend.com/emails?limit=100', auth),
  ]);
  const domainRows = ((domains.data as { name?: string; status?: string }[] | undefined) ?? []).map(
    (d) => [`Domain ${d.name ?? '?'}`, d.status ?? 'unknown'] as [string, string],
  );
  const since = isoDaysAgo(deps.now, 7);
  const recent = (
    (emails.data as { created_at?: string; last_event?: string }[] | undefined) ?? []
  ).filter((e) => (e.created_at ?? '') >= since);
  const count = (event: string) => recent.filter((e) => e.last_event === event).length;
  const bounced = count('bounced');
  const complained = count('complained');
  const unverified = domainRows.some(([, status]) => status !== 'verified');
  return {
    title,
    status: bounced + complained > 0 || unverified ? 'attention' : 'ok',
    rows: [
      ...domainRows,
      ['Sent, last 7 days (latest 100)', String(recent.length)],
      ['Bounced', String(bounced)],
      ['Marked as spam', String(complained)],
    ],
    link: { label: 'Open Resend', href: 'https://resend.com/emails' },
  };
}

// ---------------------------------------------------------------- Search Console

/** A Google access token for a service account (JWT bearer grant). */
export async function googleAccessToken(serviceAccountJson: string, deps: Deps): Promise<string> {
  const account = JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string };
  if (!account.client_email || !account.private_key) throw new Error('bad service account');
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const iat = Math.floor(deps.now.getTime() / 1000);
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  const pem = account.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  );
  const sig = btoa(String.fromCharCode(...signature))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const body = await getJson(deps, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }).toString(),
  });
  if (typeof body.access_token !== 'string') throw new Error('no token');
  return body.access_token;
}

export async function searchPanel(env: Env, deps: Deps): Promise<Panel> {
  const title = 'Search (Search Console)';
  if (!env.GOOGLE_SERVICE_ACCOUNT || !env.SEARCH_CONSOLE_SITE)
    return notConfigured(title, 'GOOGLE_SERVICE_ACCOUNT (restricted user on the property)');
  const token = await googleAccessToken(env.GOOGLE_SERVICE_ACCOUNT, deps);
  const site = encodeURIComponent(env.SEARCH_CONSOLE_SITE);
  const base = `https://www.googleapis.com/webmasters/v3/sites/${site}`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // Search data lags about two days.
  const end = isoDaysAgo(deps.now, 2).slice(0, 10);
  const start = isoDaysAgo(deps.now, 29).slice(0, 10);
  const [totals, queries, sitemaps] = await Promise.all([
    getJson(deps, `${base}/searchAnalytics/query`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ startDate: start, endDate: end }),
    }),
    getJson(deps, `${base}/searchAnalytics/query`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['query'], rowLimit: 5 }),
    }),
    getJson(deps, `${base}/sitemaps`, { headers: auth }),
  ]);
  interface Row {
    keys?: string[];
    clicks?: number;
    impressions?: number;
  }
  const total = ((totals.rows as Row[] | undefined) ?? [])[0];
  const top = ((queries.rows as Row[] | undefined) ?? []).map(
    (r) =>
      [
        `“${r.keys?.[0] ?? ''}”`,
        `${String(r.clicks ?? 0)} clicks · ${String(r.impressions ?? 0)} views`,
      ] as [string, string],
  );
  const sitemapList =
    (sitemaps.sitemap as
      { path?: string; errors?: string; lastDownloaded?: string }[] | undefined) ?? [];
  const sitemapErrors = sitemapList.reduce((n, s) => n + Number(s.errors ?? 0), 0);
  return {
    title,
    status: sitemapErrors > 0 ? 'attention' : 'ok',
    rows: [
      ['Clicks, last 28 days', String(total?.clicks ?? 0)],
      ['Views in results', String(total?.impressions ?? 0)],
      ...top,
      [
        'Sitemaps',
        sitemapList.length === 0
          ? 'none submitted'
          : `${String(sitemapList.length)} · ${String(sitemapErrors)} with errors`,
      ],
    ],
    link: { label: 'Open Search Console', href: 'https://search.google.com/search-console' },
  };
}

/** The accounts panel needs a database decision first (see ADR-0026). */
export function accountsPanel(): Panel {
  return {
    title: 'Accounts (Supabase)',
    status: 'not_configured',
    rows: [],
    note: 'Not set up yet: needs the owner to approve how the dashboard reads account counts (ADR-0026).',
    link: {
      label: 'Open Supabase',
      href: 'https://supabase.com/dashboard/project/fhclnxqumcdsqxyunelp',
    },
  };
}

export async function allPanels(env: Env, deps: Deps): Promise<Panel[]> {
  return Promise.all([
    Promise.resolve(accountsPanel()),
    safely('Revenue (Paddle)', () => paddlePanel(env, deps)),
    safely('Email (Resend)', () => resendPanel(env, deps)),
    safely('Search (Search Console)', () => searchPanel(env, deps)),
    safely('Site (Cloudflare)', () => cloudflarePanel(env, deps)),
    safely('Product health (GitHub)', () => githubPanel(env, deps)),
  ]);
}
