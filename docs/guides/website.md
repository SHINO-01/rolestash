# Website (rolestash.com)

The marketing and legal site is plain static HTML in `site/`: no build step,
one small first-party script (the light/dark switch, and playing the hero
film while it's on screen), no third-party requests. An assets-only Cloudflare Worker
serves it from `main`, so the site only changes after CI has promoted a
tested commit (docs/guides/ci-cd.md).

| Path                                        | Page                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `site/index.html`                           | Landing page: promise, hero film, five feature clips, proof, FAQ, one CTA           |
| `site/privacy/`                             | Privacy policy (also the store listing URL)                                         |
| `site/terms/`                               | Terms of service (Paddle wording included)                                          |
| `site/refunds/`                             | Refund policy                                                                       |
| `site/support/`                             | Support and FAQ                                                                     |
| `site/404.html`                             | Not found                                                                           |
| `site/pay/`                                 | Paddle checkout (default payment link); `pay/success/` after paying                 |
| `site/pricing/`                             | Local prices and Subscribe (ADR-0023); `site/welcome/` after paying                 |
| `site/auth/google/`                         | Google sign-in hand-off (ADR-0012); own script and CSP                              |
| `site/notify/`                              | Launch-list result pages (check email, confirmed, unsubscribed, problem)            |
| `site/job-sites/`                           | Supported job sites, generated from the adapter registry (`npm run docs:sites`)     |
| `site/australia/`                           | Rolestash for Australia: Australian sites it reads (generated list), data in Sydney |
| `site/private-job-tracker/`                 | Privacy explainer: what's stored, no AI, no inbox, questions to ask any tracker     |
| `site/compare/teal/`, `site/compare/huntr/` | Comparisons with sources and a "facts checked" date: re-check every 3 months        |
| `site/guides/track-job-applications/`       | Guide: what to record, stages, follow-ups, free CSV template                        |
| `site/changelog/`                           | Changelog, rendered from `CHANGELOG.md` (`npm run site:changelog`)                  |
| `site/known-issues/`                        | Known issues: open bugs with status and workarounds, and limitations                |
| `site/sitemap/`                             | Every page, for people (search engines use `sitemap.xml`)                           |
| `site/_headers`                             | CSP and security headers                                                            |
| `site/assets/`                              | CSS, self-hosted Bricolage Grotesque (OFL), logos, screenshots, the film            |

## Rules

- **One script, no inline code or styles, nothing from other origins.** The
  CSP in `_headers` is `default-src 'none'; script-src 'self'` (plus
  `media-src 'self'` for the hero film), and `tests/unit/site/site.test.ts`
  enforces it. Every page loads only
  `assets/theme.js`, first in `<head>` (not deferred) so a saved theme
  applies before the first paint.
- **The light/dark switch** (`.theme-toggle` in the shared header) follows
  the system setting until the visitor picks a theme, then remembers it in
  local storage (named in the privacy policy). Dark styles are written
  twice, as `:root[data-theme='dark'] …` and as
  `:root:not([data-theme='light']) …` inside the dark media query. The new
  theme grows from the switch in a circle (View Transitions); with reduced
  motion it changes at once. The switch stays hidden if the script doesn't
  run.
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
  the promise, five features, proof and the FAQ; plan details live on
  `/pricing/`. Product truth and voice are in `PRODUCT.md`.
- **Proof is facts only.** No testimonials until real beta testers agree to
  be quoted; then add them inside the proof grid as
  `<figure class="proof-quote"><blockquote>…</blockquote><figcaption>Name, role</figcaption></figure>`.
- **Type is one family:** Bricolage Grotesque (variable weight and optical
  size), from `@fontsource-variable/bricolage-grotesque`, copied to
  `site/assets/bricolage-latin.woff2` with its licence. Inter stays only for
  the OG image script.
- **Motion explains the product.** The hero film and the five feature clips
  are video; everything else is CSS. The hero settles in on load and FAQ
  answers open with a height transition. Nothing animates or plays under
  `prefers-reduced-motion` (the clips keep their posters), and the content is
  complete without motion. Prefer CSS: the one script exists because
  remembering a theme across pages, and playing videos only while they're
  visible, need one.
- **The changelog page is generated.** Never edit `site/changelog/` by
  hand: write the entry in `CHANGELOG.md` and run `npm run site:changelog`
  (the release command does it too). ADR references are dropped and
  _Unreleased_ shows as "Next update".
- **Known issues are kept by hand.** Add a confirmed bug with who it
  affects, its status and a workaround; when a release fixes it, move it out
  (the changelog records the fix) and update "Last updated" and the version.
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
tokens. The landing page is: hero (the film, with the framed board screenshot as fallback), five
features with a clip each, the specifics (proof), FAQ and a closing call to
action; plans and prices are on `/pricing/`.

## The hero film

The homepage hero plays a 45-second launch film (no voice): a buried inbox
becomes one board, then the five Free features, "That's not all.", and the
five Pro features. The landscape cut (1920×1080) shows above 640 px and a
vertical cut (1080×1920) on phones and small screens. Each cut is its own
`<video>`; CSS shows one, and the hidden one never intersects, so it never
plays. Each poster (the closing frame with the call to action) is preloaded
only for its screen size.

Its source is the HyperFrames project made with `/brag` in
`brag-output-2026-10-06-232216/` (gitignored): `brag-plan.md`,
`composition-brief.md`, the scenes in `composition/compositions/`, and
`work/build.mjs`, which writes both `composition/` (landscape) and
`composition-vertical/` from one scene table (portrait overrides apply in
the vertical copy). Every cut lands on the beat grid of "Young Black & Rich
(Rock Remix)" (129 BPM, the drop at 4.21 s), so the silent hero and the
social cuts share one timeline. The renders there:

- `brag.mp4`, `brag-vertical.mp4`: with the music, for social posts;
- `brag-silent.mp4`, `brag-vertical-silent.mp4`: the hero's source.

| File                                                | What                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `site/assets/rolestash-film-2.webm`                 | VP9, 1920×1080, no audio, about 3.6 MB           |
| `site/assets/rolestash-film-2.mp4`                  | H.264, 1600×900, no audio, about 3.2 MB          |
| `site/assets/rolestash-film-2-poster.webp`          | The closing frame (CTA), 1600 wide, ~40 KB       |
| `site/assets/rolestash-film-2-vertical.webm`        | Vertical cut, VP9, 1080×1920, no audio, ~3.4 MB  |
| `site/assets/rolestash-film-2-vertical.mp4`         | Vertical cut, H.264, 900×1600, no audio, ~3.4 MB |
| `site/assets/rolestash-film-2-vertical-poster.webp` | Vertical closing frame, 900 wide, ~40 KB         |

- **Player:** always silent (owner's choice, 2026-10-04): the encodes carry
  no audio track, and the `<video muted playsinline loop preload="metadata">`
  has no controls or buttons. `theme.js` plays it only while a quarter of it
  is on screen; without the script it shows the poster.
- **Reduced motion:** CSS hides the film and shows the light/dark board
  pictures (now `loading="lazy"`, so they aren't fetched while hidden).
- **LCP:** the poster is the hero's largest paint. It is preloaded (only when
  motion is allowed) and the film's entrance moves without fading, so it
  paints at once. Measured locally on throttled 4G with 4× CPU on
  2026-10-04: LCP about 1.6 s on desktop and 1.7 s on a phone (vertical
  poster), CLS 0.
- **Budget (tested):** each encode under 4 MB, the poster under 150 KB.
- **Re-encoding** from a new render (paths relative to the brag output folder;
  the 45-second film needs `-crf 38`/`-crf 28` to stay under the 4 MB budget,
  and the vertical WebM `-crf 40`):

  ```bash
  ffmpeg -i brag-silent.mp4 -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -cpu-used 2 -an site/assets/rolestash-film-2.webm
  ffmpeg -i brag-silent.mp4 -vf scale=1600:-2 -c:v libx264 -preset veryslow -crf 28 -pix_fmt yuv420p -an -movflags +faststart site/assets/rolestash-film-2.mp4
  ffmpeg -i brag.jpg -vf scale=1600:-2 -c:v libwebp -quality 78 site/assets/rolestash-film-2-poster.webp
  ```

  The vertical cut is encoded the same way from `brag-vertical-silent.mp4`
  (MP4 at `scale=900:-2`). HyperFrames pads a 1080-wide render to a multiple
  of 16, which leaves an 8 px black strip on the right: crop it first with
  `-vf "crop=1072:1920:0:0,scale=1080:1920"` on the rendered file (done for
  the current cut).
  Render on this machine with `--workers 3`: the default worker count ran
  out of memory on the vertical render.

  Use new file names when the film changes: assets are cached for a day.

- **Copy in the film is the site's own** (fictional companies only), like the
  screenshots.

## Feature clips

The five features on the homepage (save, autofill, the board, email updates,
the phone) each show a short clip of the **real product**: the E2E build of
the extension and the web board, driven by Playwright against the mock
backend, on fictional companies' pages (`tests/fixtures/clips/`). Because
they're recorded from the product, they can be re-shot whenever the UI
changes instead of going stale:

```bash
npm run site:clips
```

That builds the E2E extension and web board, records each flow
(`tests/clips/clips.spec.ts`, Playwright project `clips`) with Chrome's
screencast at 2× and a drawn cursor (a fingertip on the phone), and encodes
`site/assets/feature-<name>-<version>.{webm,mp4}` plus a `-poster.webp`
(`scripts/encode-site-clips.ts`).

- **Silent, no player UI:** the encodes have no audio track (a site test
  checks the files), and the `<video muted playsinline loop preload="none">`
  has no controls, the same as the hero film. `theme.js` plays a clip while a
  quarter of it is on screen and restarts it from the beginning when it comes
  back into view.
- **Posters:** the moment that sums each clip up (set per clip in the
  encoder), shown before it plays and to anyone who prefers reduced motion.
- **Budget (tested):** each encode under 1 MB (they're 120 to 400 KB), each
  poster under 150 KB.
- **New version on change:** bump `VERSION` in the encoder and the file names
  in `site/index.html`, since assets are cached for a day. The encoder
  deletes the old version's files.
- Desktop clips are 16:10 (880×550 or 1000×625 CSS pixels, so the UI reads at
  the size the page shows them); the phone clip is 390×844 in a phone frame.

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

## Search

Public pages (`/`, `/pricing/`, `/support/`, `/privacy/`, `/terms/`,
`/refunds/`, the content pages below, and the changelog, known-issues and
sitemap pages) are indexed; checkout, sign-in, welcome and email-confirmation
pages carry `noindex`, as does the 404 page. Site tests enforce the rules
below.

- **`sitemap.xml`** lists exactly the indexable pages. Add a page there when
  you add one, and bump its `lastmod` when its content changes.
- **`robots.txt`** allows everything and points at the sitemap. It doesn't
  block the `noindex` pages, so search engines can see their `noindex`.
- **Every indexable page** has a unique title (60 characters or less), a
  unique description (70–160), a canonical URL with a trailing slash,
  matching `og:`/`twitter:` tags with the share card, and JSON-LD.
- **JSON-LD:** the homepage describes the organisation, the website, the
  extension with its plans, Free and Pro (`SoftwareApplication` offers in USD), and
  the FAQ, copied word for word from the visible questions (a test checks).
  Other pages carry a breadcrumb. JSON-LD is data, so the CSP doesn't apply
  to it. Never add ratings or reviews until real ones exist.
- **Content pages** target searches we can honestly win, where Rolestash is
  unusually specific: privacy (no AI, no inbox, no account), Australia
  (SEEK and local sites, data in Sydney), particular job sites, and people
  outgrowing a spreadsheet. Each answers its topic directly, in the product
  voice, with question headings and a matching `FAQPage` (or `Article`)
  JSON-LD, and links to the others. Only facts the product backs up.
- **Comparison pages** (`/compare/teal/`, `/compare/huntr/`, owner decision
  2026-10-04) name competitors, so every statement about them comes from
  their own pricing page, privacy policy or Chrome Web Store listing, linked
  under _Sources_, with a "Facts checked" date. Say where they're the better
  choice. Re-check the facts every three months (and before any campaign),
  update the date, and keep the trademark note.
- **Generated lists:** `/job-sites/` and `/australia/` list the adapters
  between `<!-- sites:*:start/end -->` markers. `npm run docs:sites` rewrites
  them with the docs; a test fails if they're stale.
- **The homepage JSON-LD** also carries a `VideoObject` for the hero film and
  the app's feature list, screenshot, help page and store listing (`sameAs`).
- **`llms.txt`** summarises the product and its pages in plain text for AI
  assistants that look for it. Keep its facts in step with the site.
- **One `h1` per page and headings in order**, and every image has `alt`
  (empty for decoration).
- **Search Console:** the domain is verified by a DNS TXT record. After
  structural changes, open Search Console → **Sitemaps** and submit
  `https://rolestash.com/sitemap.xml` (not `/sitemap/`, which is the page
  for people: Search Console rejects it as "Sitemap is HTML"); use **URL inspection** → _Request
  indexing_ for a changed page.

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
- **Never add Worker routes for the site, least of all wildcards.** On
  2026-10-05 a dashboard route `*.rolestash.com/*` on `rolestash-v001`
  caught `operations.rolestash.com` before its own custom domain, so the
  dashboard showed the marketing site. It was deleted; custom domains
  cover every host we serve (table below).
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
`landing.rolestash.com`. Every hostname, and what serves it:

| Hostname                   | Served by                                        | How                                     |
| -------------------------- | ------------------------------------------------ | --------------------------------------- |
| `rolestash.com`            | `rolestash-v001` (the site)                      | Custom domain                           |
| `www.rolestash.com`        | Redirect Rule to `rolestash.com`                 | Custom domain on `rolestash-v001`       |
| `operations.rolestash.com` | `rolestash-ops` ([operations.md](operations.md)) | Custom domain, behind Cloudflare Access |
| `in.rolestash.com`         | `rolestash-email` (email only, no web)           | Email Routing                           |

No Worker routes. To check: Workers & Pages → each Worker → Domains should
list only "Production" custom domains. Leave **Web Analytics off**, because the privacy
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
