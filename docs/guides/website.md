# Website (rolestash.com)

The marketing and legal site is plain static HTML in `site/`: no build step,
no JavaScript, no third-party requests. Cloudflare Pages serves it from
`main`, so the site only changes after CI has promoted a tested commit
(docs/guides/ci-cd.md).

| Path              | Page                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `site/index.html` | Landing page: features, pricing, FAQ                                |
| `site/privacy/`   | Privacy policy (also the store listing URL)                         |
| `site/terms/`     | Terms of service (Paddle wording included)                          |
| `site/refunds/`   | Refund policy                                                       |
| `site/support/`   | Support and FAQ                                                     |
| `site/404.html`   | Not found                                                           |
| `site/pay/`       | Paddle checkout (default payment link); `pay/success/` after paying |
| `site/_headers`   | CSP and security headers (Cloudflare Pages)                         |
| `site/assets/`    | CSS, self-hosted Inter (OFL), logos, board screenshots              |

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
- Every page shares the landing page's header and footer, which is also
  tested. Change the header or footer in every page.
- **Legal pages describe what actually ships.** Update the privacy policy
  in the same PR as any change to what the extension or backend collects,
  and bump "Last updated".
- Screenshots use fictional companies only. Never show real employers or
  job boards' branding.

## Preview locally

```bash
python3 -m http.server 4321 --directory site
```

## One-time Cloudflare Pages setup

1. Cloudflare dashboard → _Workers & Pages_ → _Create_ → _Pages_ →
   _Connect to Git_ → choose `SHINO-01/rolestash`.
2. Production branch: `main`. Framework preset: _None_. Build command:
   empty. Build output directory: `site`.
3. _Settings → Builds → Branch control_: turn off preview deployments, or
   limit them to `dev`.
4. _Custom domains_: add `rolestash.com` and `www.rolestash.com`. Cloudflare
   creates the DNS records because the domain is on Cloudflare. Add a
   redirect rule from `www` to the apex.
5. Leave **Web Analytics off**. The privacy policy says the site has no
   analytics.
