import { html, type Html } from './html';
import type { Panel } from './panels';

/**
 * The dashboard's layout and shared pieces (ADR-0026, ADR-0037): server-
 * rendered HTML, one stylesheet, no scripts. Pages: Overview, Grants,
 * Discounts, Referrals, Activity.
 */

export type PageId = 'overview' | 'grants' | 'discounts' | 'referrals' | 'activity';

export const NAV: { id: PageId; href: string; label: string }[] = [
  { id: 'overview', href: '/', label: 'Overview' },
  { id: 'grants', href: '/grants', label: 'Grants' },
  { id: 'discounts', href: '/discounts', label: 'Discount codes' },
  { id: 'referrals', href: '/referrals', label: 'Referrals' },
  { id: 'activity', href: '/activity', label: 'Activity' },
];

export const CSS = `:root{color-scheme:light dark;--bg:#f6f5f2;--panel:#fff;--sunk:#f1efea;--ink:#14201d;--muted:#5b6965;--faint:#8b9692;--line:#e5e2db;--line-2:#d4d0c6;--accent:#0b5d52;--accent-2:#08483f;--accent-ink:#fff;--accent-soft:#e3f1ec;--warn:#8a5300;--warn-soft:#fcf0d6;--bad:#a1263a;--bad-soft:#fbe8eb;--shadow:0 1px 2px rgb(20 32 29/5%),0 4px 16px -8px rgb(20 32 29/12%)}
@media (prefers-color-scheme:dark){:root{--bg:#0d1211;--panel:#141b19;--sunk:#101614;--ink:#e9efed;--muted:#a2b0ab;--faint:#738079;--line:#232d2a;--line-2:#33403c;--accent:#5cc4ad;--accent-2:#7fd4c0;--accent-ink:#06231d;--accent-soft:#16312b;--warn:#f2c46a;--warn-soft:#33270f;--bad:#ff8fa0;--bad-soft:#3a1a20;--shadow:none}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
a{color:var(--accent)}a:hover{color:var(--accent-2)}
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;padding:22px 14px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:2px}
.brand{display:flex;align-items:center;gap:10px;padding:2px 10px 18px;font-weight:650;letter-spacing:-.01em;white-space:nowrap}
.brand i{width:22px;height:22px;border-radius:7px;background:var(--accent);display:inline-block}
.side a{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:8px;color:var(--muted);text-decoration:none;font-weight:500}
.side a:hover{background:var(--sunk);color:var(--ink)}.side a[aria-current=page]{background:var(--panel);color:var(--ink);box-shadow:var(--shadow);border:1px solid var(--line)}
.side .count{font-size:12px;color:var(--faint)}.side .count.hot{color:var(--warn)}
.side .who{margin-top:auto;padding:10px;font-size:12px;color:var(--faint);overflow-wrap:anywhere}
main{padding:30px 36px 72px;max-width:1120px;width:100%}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:0 0 22px;flex-wrap:wrap}
h1{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:0}h2{font-size:15px;margin:0;letter-spacing:-.005em}
.sub{color:var(--muted);margin:4px 0 0}.faint{color:var(--faint)}.muted{color:var(--muted)}
.stack{display:flex;flex-direction:column;gap:16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
.two{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow);min-width:0}
.card>h2{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
.kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow)}
.kpi .n{font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.2}.kpi .l{color:var(--muted);font-size:13px}.kpi .d{color:var(--faint);font-size:12px}
.attention{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.attention li{display:flex;gap:10px;align-items:baseline;padding:10px 14px;border-radius:10px;background:var(--warn-soft);color:var(--warn)}
.attention li a{margin-left:auto;white-space:nowrap}.allclear{padding:12px 14px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-weight:500}
table{width:100%;border-collapse:collapse}th{font-size:12px;font-weight:600;color:var(--faint);text-align:left;padding:0 10px 8px 0;white-space:nowrap}
td{padding:9px 10px 9px 0;border-top:1px solid var(--line);vertical-align:top}td.r,th.r{text-align:right}td.num{text-align:right;font-weight:600}
.kv td:first-child{color:var(--muted)}.kv td:last-child{text-align:right;font-weight:600}
.scroll{overflow-x:auto}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted);white-space:nowrap}
.pill.ok{color:var(--accent);border-color:transparent;background:var(--accent-soft)}.pill.attention,.pill.pending{color:var(--warn);border-color:transparent;background:var(--warn-soft)}.pill.error,.pill.void{color:var(--bad);border-color:transparent;background:var(--bad-soft)}
form{margin:0}.form{display:grid;gap:12px 14px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));align-items:end}
.form .wide{grid-column:1/-1}
label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:500;color:var(--muted)}
input,select,textarea{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line-2);border-radius:9px;padding:8px 10px;min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
fieldset{border:0;padding:0;margin:0;display:flex;gap:14px;flex-wrap:wrap}legend{font-size:13px;font-weight:500;color:var(--muted);margin-bottom:6px}
fieldset label{flex-direction:row;align-items:center;gap:6px;color:var(--ink);font-weight:400}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-weight:600;padding:8px 14px;border-radius:9px;border:1px solid var(--line-2);background:var(--panel);color:var(--ink);cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--sunk)}.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}.btn.primary:hover{background:var(--accent-2)}
.btn.danger{color:var(--bad)}.btn.small{padding:4px 10px;font-size:13px}.btn.link{border:0;background:none;padding:0;color:var(--accent);font-weight:500}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.notice{padding:12px 14px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-weight:500}
.error{padding:12px 14px;border-radius:10px;background:var(--bad-soft);color:var(--bad);font-weight:500}
.confirm{max-width:640px}.confirm ul{margin:8px 0 0;padding-left:18px}.confirm li{margin:4px 0}
.setup{font-size:13px;color:var(--muted)}code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--sunk);padding:1px 5px;border-radius:5px}
details summary{cursor:pointer;color:var(--muted);font-weight:500}.narrow{width:7em}
@media (max-width:860px){.shell{grid-template-columns:1fr}.side{position:static;height:auto;flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line);padding:10px 12px;gap:4px}.brand{padding:4px 8px 4px 4px}.side .who{display:none}.side a{white-space:nowrap}main{padding:22px 16px 56px}.two{grid-template-columns:1fr}}`;

export interface NavCounts {
  grants?: number;
  referrals?: number;
}

export function page(input: {
  title: string;
  current: PageId;
  email: string;
  counts?: NavCounts;
  body: Html;
}): string {
  const count = (id: PageId) => {
    const n =
      id === 'grants'
        ? input.counts?.grants
        : id === 'referrals'
          ? input.counts?.referrals
          : undefined;
    return n ? html`<span class="count${id === 'referrals' ? ' hot' : ''}">${n}</span>` : null;
  };
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${input.title} · Rolestash operations</title>
        <link rel="stylesheet" href="/ops.css" />
      </head>
      <body>
        <div class="shell">
          <nav class="side" aria-label="Sections">
            <div class="brand"><i aria-hidden="true"></i>Rolestash ops</div>
            ${NAV.map(
              (n) =>
                html`<a
                  href="${n.href}"
                  ${n.id === input.current ? html` aria-current="page"` : null}
                  >${n.label}${count(n.id)}</a
                >`,
            )}
            <div class="who">${input.email}</div>
          </nav>
          <main>${input.body}</main>
        </div>
      </body>
    </html>`.value;
}

export const STATUS_LABEL: Record<Panel['status'], string> = {
  ok: 'OK',
  attention: 'Look',
  not_configured: 'Not set up',
  error: 'Error',
};

export function panelCard(p: Panel): Html {
  return html`<section class="card">
    <h2>${p.title} <span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></h2>
    ${
      p.rows.length
        ? html`<table class="kv">
            ${p.rows.map(
              ([k, v]) =>
                html`<tr>
                  <td>${k}</td>
                  <td>${v}</td>
                </tr>`,
            )}
          </table>`
        : null
    }
    ${p.note ? html`<p class="faint">${p.note}</p>` : null}
    ${p.link ? html`<p><a href="${p.link.href}" rel="noopener noreferrer">${p.link.label} ↗</a></p>` : null}
  </section>`;
}

export const pageHead = (title: string, sub?: string | Html, right?: Html): Html =>
  html`<div class="head">
    <div>
      <h1>${title}</h1>
      ${sub ? html`<p class="sub">${sub}</p>` : null}
    </div>
    ${right ?? null}
  </div>`;

export const notice = (text: string | undefined): Html | null =>
  text ? html`<p class="notice" role="status">${text}</p>` : null;

export const errorBox = (text: string | undefined): Html | null =>
  text ? html`<p class="error" role="alert">${text}</p>` : null;

/** A form posting to one of the dashboard's actions; `token` covers `_action` only (the first step). */
export function actionForm(action: string, token: string, inner: Html, className = ''): Html {
  return html`<form method="post" action="/do" ${className ? html` class="${className}"` : null}>
    <input type="hidden" name="_action" value="${action}" />
    <input type="hidden" name="_step" value="preview" />
    <input type="hidden" name="_token" value="${token}" />
    ${inner}
  </form>`;
}

/** "31 Jan 2027" in Sydney; "—" for nothing; "indefinite" for the far future. */
export function day(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '—';
  if (iso.startsWith('9999-')) return 'indefinite';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso.slice(0, 10)
    : at.toLocaleDateString('en-AU', {
        timeZone: 'Australia/Sydney',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

export function dayTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString('en-AU', {
        timeZone: 'Australia/Sydney',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
}
