# Website (rolestash.com)

The marketing and legal site is plain static HTML in `site/`: no build step,
no JavaScript, no third-party requests. An assets-only Cloudflare Worker
serves it from `main`, so the site only changes after CI has promoted a
tested commit (docs/guides/ci-cd.md).

| Path                | Page                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `site/index.html`   | Landing page: features, pricing, FAQ                                     |
| `site/privacy/`     | Privacy policy (also the store listing URL)                              |
| `site/terms/`       | Terms of service (Paddle wording included)                               |
| `site/refunds/`     | Refund policy                                                            |
| `site/support/`     | Support and FAQ                                                          |
| `site/404.html`     | Not found                                                                |
| `site/pay/`         | Paddle checkout (default payment link); `pay/success/` after paying      |
| `site/auth/google/` | Google sign-in hand-off (ADR-0012); own script and CSP                   |
| `site/notify/`      | Launch-list result pages (check email, confirmed, unsubscribed, problem) |
| `site/_headers`     | CSP and security headers                                                 |
| `site/assets/`      | CSS, self-hosted Inter (OFL), logos, board screenshots                   |

## Rules

- **No scripts, no inline styles, nothing from other origins.** The CSP in
  `_headers` is `default-src 'none'`, and `tests/unit/site/site.test.ts`
  enforces it.
- **The one exception is `/pay/`.** It loads Paddle.js from `cdn.paddle.com`
  and our `assets/pay.js`, under its own CSP. The `/pay/*` rule detaches the
  site-wide header first, because two CSP headers would both apply.
  - To go live, put the Paddle **client-side token** (public; `test_…` in the
    sandbox, `live_…` in production) and the environment in
    `site/assets/pay.js`.
  - After the first sandbox checkout, check the browser console for CSP
    violations and adjust `/pay/*` if Paddle needs another origin.
- **Every page shares the landing page's header and footer**, byte for byte
  (tested). Edit them in `site/index.html`, then run `npm run site:chrome` to
  stamp them onto every other page.
- **Interactivity is CSS-only.** The mobile menu and the FAQ are `<details>`
  elements; motion lives under `prefers-reduced-motion: no-preference`, and
  scroll reveals only run where `animation-timeline: view()` is supported.
- **Images carry `width` and `height`** (tested), including each `<source>`
  in a `<picture>`, so nothing shifts while loading.
- **Plan CTAs link to the launch-list form** (`/#notify`) until the store
  listing and live payments exist (launch rule, ADR-0013). The form posts to
  the `launch-list` Edge Function, the one form action the CSP allows. See
  [launch-list.md](launch-list.md). At launch, point the CTAs at the store
  listing.
- **Legal pages describe what actually ships.** Update the privacy policy
  in the same PR as any change to what the extension or backend collects,
  and bump "Last updated".
- Screenshots use fictional companies only. Never show real employers or
  job boards' branding.

## The web board (`/board/`)

A built app, not a hand-written page (ADR-0017):

- **Source:** `src/web/` and `web/`.
- **Build:** `npm run build:web` writes to `site/board/` (gitignored). CI
  builds it before every deploy.
- **CSP:** its own, on `/board/*` in `_headers`, connecting only to our
  Supabase project. A site test checks the CSP.
- **Tests:** `npm run build:web:e2e && npx playwright test --project=web`.

## Layout and styles

`site/assets/site.css` holds everything, organised by section. Colours are
custom properties on `:root`, redefined under `prefers-color-scheme: dark`;
the privacy band and closing call to action use the always-dark `--band-*`
tokens. The landing page is: hero (framed board screenshot), features
(bento grid), how it works, email updates (Advanced), privacy, pricing
(cards everywhere, plus a comparison table above 860 px; below that the cards
list their features), FAQ and a closing call to action.

## Board screenshots

`site/assets/board-{light,dark}-{960,1536,2304}.webp` (full board) and
`board-{light,dark}-sm-{640,960}.webp` (first columns, for phones) come from
the E2E build seeded with fictional jobs:

```bash
npm run site:screenshots
```

Edit the seeded jobs in `scripts/site-screenshots.ts`. Use fictional
employers only.

## Link previews

Pages share `site/assets/og-image.png` (1200×630) through Open Graph and
Twitter card tags. It's a PNG because many chat apps don't show WebP
previews. Regenerate it after changing the screenshots or the headline:

```bash
npm run site:og
```

Chat apps cache previews, so a changed image can take days to show for a
link that was already shared.

## Scripts Cloudflare injects

Checked live on 2026-10-01: Cloudflare adds two scripts to our HTML at the
edge.

| Script           | What it is                                                                                               | Effect                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| An inline script | **JavaScript Detections** (bot management), which would load `/cdn-cgi/challenge-platform/…/jsd/main.js` | Blocked by our CSP (no inline scripts), so it never runs   |
| `beacon.min.js`  | **Web Analytics (RUM)**, from `static.cloudflareinsights.com`, injected only for real browsers           | Blocked by CSP before any request is made; no data is sent |

**Both are inert**, so "no analytics" stays true. The only symptom is two
CSP errors in the browser console.

- **Test:** _keeps scripts Cloudflare injects inert_ in
  `tests/unit/site/site.test.ts` fails if any page's CSP ever allows inline
  scripts, eval or Cloudflare's script hosts.
- **Removing them at the source** (optional, cosmetic):
  - turn off Web Analytics / RUM for the `rolestash.com` zone;
  - turn off JavaScript Detections, if the plan offers the toggle.

## Preview locally

```bash
python3 -m http.server 4321 --directory site
```

## Deployment

The site is served by an **assets-only Cloudflare Worker**, `rolestash-v001`.
Cloudflare's Git integration isn't used, so Cloudflare never needs access to
the repo. Instead, the _Deploy rolestash.com_ job in `ci.yml` runs
`wrangler deploy --config infra/site.wrangler.jsonc` after _Promote to main_.
The site therefore only ever serves tested commits from `main`.

- **Routes:** the config declares none, so custom domains stay managed in
  the dashboard and a deploy never changes them.
- **No extra URLs:** `workers_dev` and `preview_urls` are off, so no extra
  public URLs exist.
- **No telemetry:** Wrangler's telemetry is disabled in CI.

Check a change locally with
`npx wrangler@4.144.0 deploy --config infra/site.wrangler.jsonc --dry-run`.

It is enabled by three repo settings:

| Setting                 | Kind     | Value                                                                 |
| ----------------------- | -------- | --------------------------------------------------------------------- |
| `SITE_DEPLOY`           | variable | `enabled`                                                             |
| `CLOUDFLARE_ACCOUNT_ID` | secret   | `49cd45db57a5ff345b63cea810ae7bae`                                    |
| `CLOUDFLARE_API_TOKEN`  | secret   | Custom token: **Account → Workers Scripts → Edit**, this account only |

Domains (on the Worker): `rolestash.com` (primary), `landing.rolestash.com`
and `www.rolestash.com`, which should redirect to the apex. Leave **Web Analytics off**:
the privacy policy says the site has none.
