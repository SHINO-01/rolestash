import { verifyAccess } from './access';
import { ACTIONS, type Action, type Args } from './actions';
import { html } from './html';
import { signForm, verifyForm } from './forms';
import {
  activityPage,
  discountsPage,
  grantsPage,
  overviewPage,
  referralsPage,
  type PageContext,
  type Rendered,
} from './pages';
import type { Deps, Env } from './panels';
import { CSS, errorBox, page, pageHead, type PageId } from './views';

/**
 * operations.rolestash.com (ADR-0026, ADR-0037): pages for the owner behind
 * Cloudflare Access, and the actions behind them. No scripts, no cookies of
 * our own, never cached, never indexed. Every change is two steps (a preview
 * stating the exact effect, then a confirm), signed for the signed-in person,
 * and only accepted from the dashboard's own pages.
 */

const HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const HTML_TYPE = { 'Content-Type': 'text/html; charset=utf-8' };

const PAGES: Record<string, PageId> = {
  '/': 'overview',
  '/grants': 'grants',
  '/discounts': 'discounts',
  '/referrals': 'referrals',
  '/activity': 'activity',
};

function respond(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...HEADERS, ...HTML_TYPE } });
}

const plain = (text: string, status: number) => new Response(text, { status, headers: HEADERS });

const SIGN_IN_AGAIN =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign in again</title>' +
  '<p>Your sign-in is more than an hour old.</p>' +
  '<p><a href="/cdn-cgi/access/logout">Sign out</a>, then open ' +
  '<a href="/">the dashboard</a> again for a new code.</p></html>';

async function renderPage(id: PageId, ctx: PageContext, url: URL): Promise<Rendered> {
  switch (id) {
    case 'overview':
      return overviewPage(ctx);
    case 'grants':
      return grantsPage(ctx, url.searchParams.get('all') === '1');
    case 'discounts':
      return discountsPage(ctx);
    case 'referrals':
      return referralsPage(ctx);
    case 'activity':
      return activityPage(ctx);
  }
}

/** Only our own messages reach the page (the database's, Paddle's summary, or ours). */
function safeError(error: unknown): string {
  if (
    error instanceof Error &&
    ['AdminError', 'PaddleAdminError', 'ActionError'].includes(error.name)
  )
    return error.message;
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message))
    return `That failed (${error.message}).`;
  return 'That failed. Nothing was changed; try again.';
}

interface Session {
  env: Env;
  deps: Deps;
  email: string;
  secret: string;
}

async function previewPage(
  s: Session,
  name: string,
  action: Action,
  args: Args,
  error?: string,
): Promise<Response> {
  const ctx = { env: s.env, deps: s.deps, actor: s.email };
  let preview;
  try {
    preview = await action.preview(ctx, args);
  } catch (e) {
    return respond(
      page({
        title: action.title,
        current: PAGES[action.page] ?? 'overview',
        email: s.email,
        body: html`${pageHead(action.title)}
          <div class="stack confirm">
            ${errorBox(safeError(e))}
            <p><a class="btn" href="${action.page}">Back</a></p>
          </div>`,
      }),
      400,
    );
  }
  const fields: Record<string, string> = { _action: name, _step: 'apply', ...args };
  const token = await signForm(s.secret, s.email, s.deps.now, fields);
  const typed = action.typed?.(args);
  const body = html`${pageHead(action.title, 'Check this, then confirm.')}
    <div class="stack confirm">
      ${errorBox(error)}
      <section class="card">
        <h2>This will</h2>
        <ul>
          ${preview.lines.map((l) => html`<li>${l}</li>`)}
        </ul>
      </section>
      <form method="post" action="/do" class="card stack">
        ${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}" />`)}
        <input type="hidden" name="_token" value="${token}" />
        ${
          typed
            ? html`<label
                ><span>Type <b>${typed}</b> to confirm</span
                ><input name="_typed" required autocomplete="off" spellcheck="false"
              /></label>`
            : null
        }
        <div class="actions">
          <button class="btn ${preview.danger ? 'danger' : 'primary'}">${preview.button}</button
          ><a class="btn link" href="${action.page}">Cancel</a>
        </div>
      </form>
    </div>`;
  return respond(
    page({ title: action.title, current: PAGES[action.page] ?? 'overview', email: s.email, body }),
    error ? 400 : 200,
  );
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

async function handleAction(request: Request, s: Session): Promise<Response> {
  // Only the dashboard's own pages may post (Access sends no cookie to other sites' forms
  // reliably enough to rely on; this and the signed token make sure).
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin !== new URL(request.url).origin || (site !== null && site !== 'same-origin'))
    return plain('Not allowed.', 403);
  const form = await request.formData().catch(() => null);
  if (!form) return plain('Bad request.', 400);
  const name = text(form, '_action');
  const step = text(form, '_step');
  const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
  if (!action) return plain('Unknown action.', 400);
  const token = text(form, '_token');

  if (step === 'preview') {
    if (!(await verifyForm(s.secret, s.email, s.deps.now, token, { _action: name })))
      return plain('This form has expired. Go back and reload the page.', 403);
    const parsed = action.parse(form, s.deps.now);
    if (typeof parsed === 'string') {
      const back = await renderPage(
        PAGES[action.page] ?? 'overview',
        context(s, undefined),
        new URL(request.url),
      );
      return respond(
        page({
          title: back.title,
          current: PAGES[action.page] ?? 'overview',
          email: s.email,
          counts: back.counts,
          body: html`${errorBox(parsed)}${back.body}`,
        }),
        400,
      );
    }
    return previewPage(s, name, action, parsed);
  }

  if (step !== 'apply') return plain('Bad request.', 400);
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key === '_token' || key === '_typed' || typeof value !== 'string') continue;
    fields[key] = value;
  }
  if (!(await verifyForm(s.secret, s.email, s.deps.now, token, fields)))
    return plain('This confirmation has expired or was changed. Start again.', 403);
  const { _action: _a, _step: _s, ...args } = fields;
  const typed = action.typed?.(args);
  if (typed && text(form, '_typed').trim().toLowerCase() !== typed.toLowerCase())
    return previewPage(s, name, action, args, `Type ${typed} exactly to confirm.`);
  let result: string;
  try {
    result = await action.apply({ env: s.env, deps: s.deps, actor: s.email }, args);
  } catch (e) {
    return previewPage(s, name, action, args, safeError(e));
  }
  const notice = result.slice(0, 300);
  const sig = await signForm(s.secret, s.email, s.deps.now, { notice });
  const to = new URL(action.page, request.url);
  to.searchParams.set('notice', notice);
  to.searchParams.set('n', sig);
  return new Response(null, {
    status: 303,
    headers: { ...HEADERS, Location: to.pathname + to.search },
  });
}

function context(s: Session, notice: string | undefined): PageContext {
  return {
    env: s.env,
    deps: s.deps,
    email: s.email,
    token: (action) =>
      s.secret ? signForm(s.secret, s.email, s.deps.now, { _action: action }) : Promise.resolve(''),
    ...(notice ? { notice } : {}),
  };
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const access = await verifyAccess(
    request,
    {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
      allowedEmails: env.OWNER_EMAILS,
    },
    deps.fetch,
    deps.now,
  );
  if (!access.ok) {
    console.log(`ops: refused (${access.reason})`);
    // Access keeps its own session cookie, which can outlive the Worker's
    // one-hour limit; signing out of Access is the only way to a fresh code.
    if (access.reason === 'login_too_old' || access.reason === 'expired')
      return respond(SIGN_IN_AGAIN, 403);
    return plain('Not allowed.', 403);
  }
  const url = new URL(request.url);
  const s: Session = { env, deps, email: access.email, secret: env.OPS_ADMIN_SECRET ?? '' };

  if (request.method === 'POST' && url.pathname === '/do') {
    if (!s.secret) return plain('Changes need OPS_ADMIN_SECRET.', 403);
    return handleAction(request, s);
  }
  if (request.method !== 'GET') return plain('Method not allowed.', 405);
  if (url.pathname === '/ops.css')
    return new Response(CSS, {
      headers: { ...HEADERS, 'Content-Type': 'text/css; charset=utf-8' },
    });
  const id = PAGES[url.pathname];
  if (!id) return plain('Not found.', 404);

  // A notice after a change, shown only if this dashboard signed it for this person.
  const text = url.searchParams.get('notice') ?? '';
  const shown =
    text &&
    s.secret &&
    (await verifyForm(s.secret, s.email, deps.now, url.searchParams.get('n') ?? '', {
      notice: text,
    }))
      ? text
      : undefined;
  const rendered = await renderPage(id, context(s, shown), url);
  return respond(
    page({
      title: rendered.title,
      current: id,
      email: access.email,
      counts: rendered.counts,
      body: rendered.body,
    }),
  );
}
