# Website (rolestash.com)

The marketing and legal site is plain static HTML in `site/`: no build step,
no JavaScript, no third-party requests. An assets-only Cloudflare Worker
serves it from `main`, so the site only changes after CI has promoted a
tested commit (docs/guides/ci-cd.md).

| Path                | Page                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `site/index.html`   | Landing page: promise, three benefits, proof, FAQ, one call to action    |
| `site/privacy/`     | Privacy policy (also the store listing URL)                              |
| `site/terms/`       | Terms of service (Paddle wording included)                               |
| `site/refunds/`     | Refund policy                                                            |
| `site/support/`     | Support and FAQ                                                          |
| `site/404.html`     | Not found                                                                |
| `site/pay/`         | Paddle checkout (default payment link); `pay/success/` after paying      |
| `site/pricing/`     | Local prices and Subscribe (ADR-0023); `site/welcome/` after paying      |
| `site/auth/google/` | Google sign-in hand-off (ADR-0012); own script and CSP                   |
| `site/notify/`      | Launch-list result pages (check email, confirmed, unsubscribed, problem) |
| `site/_headers`     | CSP and security headers                                                 |
| `site/assets/`      | CSS, self-hosted Bricolage Grotesque (OFL), logos, board screenshots     |

## Rules

- **No scripts, no inline styles, nothing from other origins.** The CSP in
  `_headers` is `default-src 'none'`, and `tests/unit/site/site.test.ts`
  enforces it.
- **The exceptions are `/pay/` and `/pricing/`.** They load Paddle.js from
  `cdn.paddle.com` and our `assets/pay.js` or `assets/pricing.js` (ES
  modules), under their own CSP. Their `_headers` rules detach the site-wide
  header first, because two CSP headers would both apply.
  - **Paddle settings** live in `site/assets/paddle-config.js`: the
    environment, the client-side token (public; `test_…` in the sandbox,
    `live_…` in production) and the price IDs. To go live, change all three
    together. `initPaddle()` refuses a mismatch.
  - `/pricing/` is `noindex` and not linked until launch.
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
- **Plan CTAs link to the Chrome Web Store listing** (since 2026-10-03).
  The closing section's form (`/#notify`) is now an optional product-news
  signup. It posts to the `launch-list` Edge Function, the one form action
  the CSP allows. See [launch-list.md](launch-list.md).
- **The homepage has one call to action, Add to Chrome.** Its sections are
  the promise, three benefits, proof and the FAQ; plan details live on
  `/pricing/`. Product truth and voice are in `PRODUCT.md`.
- **Proof is facts only.** No testimonials until real beta testers agree to
  be quoted; then add them inside the proof grid as
  `<figure class="proof-quote"><blockquote>…</blockquote><figcaption>Name, role</figcaption></figure>`.
- **Type is one family:** Bricolage Grotesque (variable weight and optical
  size), from `@fontsource-variable/bricolage-grotesque`, copied to
  `site/assets/bricolage-latin.woff2` with its licence. Inter stays only for
  the OG image script.
- **Motion is CSS only and explains the product.** The hero settles in on
  load; the save form "types" itself in and a card is dragged into
  Interviewing as they scroll into view (scroll timelines, which every
  Chrome visitor has); FAQ answers open with a height transition. Nothing
  animates under `prefers-reduced-motion`, and the content is complete
  without the animations. Adding JavaScript would mean loosening the CSP,
  so prefer CSS until something truly needs a script.
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

Pages share `site/assets/og-card.jpg` (1200×630) through Open Graph
(`og:image`, `og:image:secure_url`) and Twitter card (`twitter:image`) tags.

- **A JPEG under 300 KB** (it's about 75 KB): WhatsApp builds previews on
  the sender's phone and drops larger images, and some apps don't show
  WebP. `npm run site:og` refuses anything bigger, and a site test checks
  the size and the tags.
- **A new file name whenever the card changes:** Meta caches images by URL
  and won't fetch a changed file at the same address. (`og-image.png` was
  the first card; it stays so old cached previews still have an image.)

```bash
npm run site:og
```

**Meta apps cache previews for weeks**, including failed ones. After a
change, or if WhatsApp, Facebook, Messenger or Instagram show no preview:

1. Open the [Sharing Debugger](https://developers.facebook.com/tools/debug/)
   (any Facebook login), enter `https://rolestash.com/`, and click
   **Debug**, then **Scrape again**. Check the preview shows the card and
   there are no errors (warnings about `fb:app_id` don't matter).
2. Repeat for any other page you share (`/pricing/`, `/privacy/`).
3. WhatsApp keeps its own cache per link; a new message with the URL, or the
   URL with `?v=2` added, shows the fresh preview.

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

**Domains.** `rolestash.com` is the only canonical host. `www.rolestash.com`
is attached to the Worker and redirects to it. There is deliberately no
`landing.rolestash.com`. Leave **Web Analytics off**, because the privacy
policy says the site has none.

**The `www` redirect** is set up in the dashboard, because the CI token can't
edit DNS or rules:

1. **Workers & Pages → `rolestash-v001` → Settings → Domains & Routes →
   Add → Custom domain:** `www.rolestash.com`. This creates the proxied DNS
   record and the certificate.
2. **`rolestash.com` zone → Rules → Redirect Rules → "Redirect from WWW to
   root"** (a wildcard pattern must match the whole URL, so keep the `*`):
   - request URL `https://www.rolestash.com/*`;
   - target URL `https://rolestash.com/${1}`;
   - status 301, with _Preserve query string_ ticked.

   Redirect Rules run before the Worker, so the Worker never serves `www`.

3. **SSL/TLS → Edge Certificates → Always Use HTTPS: on**, so plain
   `http://` on either host redirects to HTTPS. HSTS alone only protects
   browsers that have already visited over HTTPS.
4. **Check:** `curl -sI https://www.rolestash.com/privacy/?x=1` returns a 301
   with `location: https://rolestash.com/privacy/?x=1`, and
   `curl -sI http://rolestash.com/` returns a redirect to `https://`.
