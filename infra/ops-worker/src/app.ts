import { verifyAccess } from './access';
import { allPanels, type Deps, type Env, type Panel } from './panels';

/**
 * operations.rolestash.com (ADR-0026): one server-rendered page for the
 * owner, behind Cloudflare Access. No scripts, no cookies of our own, no
 * storage, never cached, never indexed.
 */

const HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const STATUS_LABEL: Record<Panel['status'], string> = {
  ok: 'OK',
  attention: 'Needs attention',
  not_configured: 'Not set up',
  error: 'Error',
};

export const CSS = `:root{color-scheme:light dark;--bg:#fbfaf7;--card:#fff;--ink:#10231f;--muted:#4c5b57;--line:#e7e3da;--ok:#0b5d52;--warn:#7a4b00;--warn-bg:#fdf0d3;--err:#9b1c2c}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f0e;--card:#131a18;--ink:#eef3f1;--muted:#a3b3ae;--line:#25302d;--ok:#5cc4ad;--warn:#f7c563;--warn-bg:#3a2a0c;--err:#ff8a98}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}.meta{color:var(--muted);margin:0 0 24px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.panel h2{font-size:16px;margin:0;display:flex;justify-content:space-between;gap:8px;align-items:center}
.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;border:1px solid var(--line);color:var(--muted)}
.badge.ok{color:var(--ok)}.badge.attention{color:var(--warn);background:var(--warn-bg)}.badge.error{color:var(--err)}
table{width:100%;border-collapse:collapse;margin-top:10px}td{padding:6px 0;border-top:1px solid var(--line);vertical-align:top}
td+td{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.note{color:var(--muted);font-size:13px;margin:10px 0 0}
a{color:var(--ok)}`;

export function renderPage(panels: Panel[], email: string, now: Date): string {
  const cards = panels
    .map(
      (p) => `<section class="panel">
<h2>${escape(p.title)} <span class="badge ${p.status}">${STATUS_LABEL[p.status]}</span></h2>
${
  p.rows.length
    ? `<table>${p.rows.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join('')}</table>`
    : ''
}
${p.note ? `<p class="note">${escape(p.note)}</p>` : ''}
${p.link ? `<p class="note"><a href="${escape(p.link.href)}" rel="noopener noreferrer">${escape(p.link.label)}</a></p>` : ''}
</section>`,
    )
    .join('\n');
  const when = now.toISOString().replace('T', ' ').slice(0, 16);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Operations — Rolestash</title>
<link rel="stylesheet" href="/ops.css">
</head>
<body>
<main>
<h1>Rolestash operations</h1>
<p class="meta">Signed in as ${escape(email)} · loaded ${when} UTC · reload for fresh numbers</p>
<div class="grid">
${cards}
</div>
</main>
</body>
</html>`;
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
    return new Response('Not allowed.', { status: 403, headers: HEADERS });
  }
  if (request.method !== 'GET')
    return new Response('Method not allowed.', { status: 405, headers: HEADERS });
  const path = new URL(request.url).pathname;
  if (path === '/ops.css')
    return new Response(CSS, {
      headers: { ...HEADERS, 'Content-Type': 'text/css; charset=utf-8' },
    });
  if (path !== '/') return new Response('Not found.', { status: 404, headers: HEADERS });

  const panels = await allPanels(env, deps);
  return new Response(renderPage(panels, access.email, deps.now), {
    headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
