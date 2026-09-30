import {
  confirmationEmail,
  launchEmail,
  newsEmail,
  parseNews,
  welcomeEmail,
  type Email,
} from './launch-emails.ts';

/**
 * The Rolestash updates list behind rolestash.com's "Notify me at launch"
 * form (docs/guides/launch-list.md). One Edge Function, four actions:
 *
 *  - POST (form)                 sign up; sends a confirmation email
 *  - GET  ?confirm=<token>       confirm; sends the "you're on the list" email
 *  - GET/POST ?unsubscribe=<t>   delete the address (POST = RFC 8058 one-click)
 *  - POST ?send  (admin)         email a campaign: the launch, or product news
 *
 * Browser-facing actions answer with 303 redirects to static pages on the
 * site, so the site needs no JavaScript.
 */

export interface LaunchEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  resendApiKey: string;
  adminSecret: string;
  siteUrl: string;
  /** Origins allowed to post the signup form. */
  siteOrigins: string[];
  from: string;
  replyTo: string;
}

export interface LaunchDeps {
  env: LaunchEnv;
  fetch: typeof fetch;
}

export function readLaunchEnv(get: (name: string) => string | undefined): LaunchEnv {
  const need = (name: string): string => {
    const value = get(name);
    if (!value) throw new Error(`Missing secret ${name}`);
    return value;
  };
  const siteUrl = get('SITE_URL') ?? 'https://rolestash.com';
  return {
    supabaseUrl: need('SUPABASE_URL'),
    serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    resendApiKey: need('RESEND_API_KEY'),
    adminSecret: need('LAUNCH_ADMIN_SECRET'),
    siteUrl,
    siteOrigins: [siteUrl, siteUrl.replace('://', '://www.')],
    from: get('LAUNCH_FROM') ?? 'Rolestash <noreply@rolestash.com>',
    replyTo: get('LAUNCH_REPLY_TO') ?? 'support@rolestash.com',
  };
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 100; // Resend's batch limit

const redirect = (url: string) => new Response(null, { status: 303, headers: { Location: url } });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Compares secrets without leaking how much of them matched. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

class LaunchBackend {
  constructor(private readonly deps: LaunchDeps) {}

  private get env() {
    return this.deps.env;
  }

  async rest(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.deps.fetch(`${this.env.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.env.serviceRoleKey,
        Authorization: `Bearer ${this.env.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`${path.split('?')[0] ?? path} failed: ${response.status}`);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  }

  rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }) as Promise<T>;
  }

  functionUrl(query: string): string {
    return `${this.env.supabaseUrl}/functions/v1/launch-list?${query}`;
  }

  unsubscribeUrl(token: string): string {
    return this.functionUrl(`unsubscribe=${token}`);
  }

  /** Every email carries a one-click unsubscribe, for mail apps and in the footer. */
  message(to: string, email: Email, unsubscribeUrl: string) {
    return {
      from: this.env.from,
      to: [to],
      reply_to: this.env.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  async send(messages: unknown[]): Promise<void> {
    const batch = messages.length > 1;
    const response = await this.deps.fetch(
      `https://api.resend.com/emails${batch ? '/batch' : ''}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch ? messages : messages[0]),
      },
    );
    if (!response.ok) throw new Error(`Resend failed: ${response.status}`);
  }
}

async function signup(req: Request, backend: LaunchBackend, env: LaunchEnv): Promise<Response> {
  // Only our own form may sign people up; other sites can't post it for them.
  if (!env.siteOrigins.includes(req.headers.get('Origin') ?? '')) {
    return json(403, { error: 'forbidden_origin' });
  }
  const form = await req.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  // A field people never see; bots fill it in. Pretend it worked.
  if (field('company')) return redirect(`${env.siteUrl}/notify/check-email/`);
  const email = field('email').toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return redirect(`${env.siteUrl}/notify/problem/`);
  }
  const [result] = await backend.rpc<{ send: boolean; token: string }[]>('launch_signup', {
    p_email: email,
    p_plan: field('plan') || null,
  });
  if (result?.send) {
    const remove = backend.unsubscribeUrl(result.token);
    await backend.send([
      backend.message(
        email,
        confirmationEmail(backend.functionUrl(`confirm=${result.token}`), remove),
        remove,
      ),
    ]);
  }
  // The same answer whether or not an email was sent, so the form can't be
  // used to find out who is on the list.
  return redirect(`${env.siteUrl}/notify/check-email/`);
}

async function confirm(token: string, backend: LaunchBackend, env: LaunchEnv) {
  const [row] = await backend.rpc<{ email: string; plan: string | null; newly: boolean }[]>(
    'launch_confirm',
    { p_token: token },
  );
  if (!row) return redirect(`${env.siteUrl}/notify/problem/`);
  if (row.newly) {
    const unsubscribe = backend.unsubscribeUrl(token);
    await backend.send([
      backend.message(row.email, welcomeEmail(row.plan, unsubscribe), unsubscribe),
    ]);
  }
  return redirect(`${env.siteUrl}/notify/confirmed/`);
}

const CAMPAIGN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * POST ?send (admin): emails a campaign to every confirmed address that
 * hasn't had it yet, 100 at a time, recording each batch as sent, so a retry
 * picks up where it stopped. Body: { campaign, dryRun?, and either
 * storeUrl (campaign "launch") or source (product news, see parseNews) }.
 */
async function sendCampaign(req: Request, backend: LaunchBackend, env: LaunchEnv) {
  const secret = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!sameSecret(secret, env.adminSecret)) return json(401, { error: 'unauthorized' });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const campaign = typeof body.campaign === 'string' ? body.campaign : '';
  if (!CAMPAIGN.test(campaign)) return json(400, { error: 'invalid_campaign' });

  let compose: (plan: string | null, unsubscribe: string) => Email;
  if (campaign === 'launch') {
    const storeUrl = typeof body.storeUrl === 'string' ? body.storeUrl : '';
    if (!storeUrl.startsWith('https://chromewebstore.google.com/')) {
      return json(400, { error: 'invalid_store_url' });
    }
    compose = (plan, unsubscribe) => launchEmail(plan, storeUrl, unsubscribe);
  } else {
    const news = parseNews(typeof body.source === 'string' ? body.source : '');
    if (!news) return json(400, { error: 'invalid_news' });
    compose = (_plan, unsubscribe) => newsEmail(news, unsubscribe);
  }

  const recipients = (await backend.rest(
    'launch_subscribers?confirmed_at=not.is.null' +
      `&or=(last_campaign.is.null,last_campaign.neq.${campaign})` +
      '&select=email,plan,token&order=created_at',
  )) as { email: string; plan: string | null; token: string }[];
  if (body.dryRun !== false) {
    const preview = compose(null, backend.unsubscribeUrl('00000000-0000-0000-0000-000000000000'));
    return json(200, { dryRun: true, recipients: recipients.length, subject: preview.subject });
  }

  let sent = 0;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const chunk = recipients.slice(i, i + BATCH);
    await backend.send(
      chunk.map((r) => {
        const unsubscribe = backend.unsubscribeUrl(r.token);
        return backend.message(r.email, compose(r.plan, unsubscribe), unsubscribe);
      }),
    );
    await backend.rpc('launch_mark_sent', {
      p_campaign: campaign,
      p_tokens: chunk.map((r) => r.token),
    });
    sent += chunk.length;
  }
  return json(200, { dryRun: false, sent });
}

export async function handleLaunchList(req: Request, deps: LaunchDeps): Promise<Response> {
  const { env } = deps;
  const backend = new LaunchBackend(deps);
  const params = new URL(req.url).searchParams;
  try {
    const unsubscribe = params.get('unsubscribe');
    if (unsubscribe !== null && (req.method === 'GET' || req.method === 'POST')) {
      if (TOKEN.test(unsubscribe)) {
        await backend.rpc<boolean>('launch_unsubscribe', { p_token: unsubscribe });
      }
      return req.method === 'POST'
        ? new Response(null, { status: 200 })
        : redirect(`${env.siteUrl}/notify/unsubscribed/`);
    }
    const token = params.get('confirm');
    if (token !== null && req.method === 'GET') {
      return TOKEN.test(token)
        ? await confirm(token, backend, env)
        : redirect(`${env.siteUrl}/notify/problem/`);
    }
    if (params.has('send') && req.method === 'POST') return await sendCampaign(req, backend, env);
    if (req.method === 'POST') return await signup(req, backend, env);
    return json(405, { error: 'method_not_allowed' });
  } catch (error) {
    console.error('[rolestash] launch-list failed', error);
    return req.method === 'GET' || !params.has('send')
      ? redirect(`${env.siteUrl}/notify/problem/`)
      : json(500, { error: 'server_error' });
  }
}
