import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { format, resolveConfig } from 'prettier';
import { stampChrome } from '../../../scripts/build-site-chrome';

/** Chrome maps extension-ID hex digits 0-f to the letters a-p. */
const HEX_TO_ID = 'abcdefghijklmnop';

/**
 * rolestash.com is static HTML in site/ (see docs/guides/website.md). These
 * checks keep the site's promises: no third-party requests, a CSP-compatible
 * page (no inline styles or scripts), working internal links, and the legal
 * pages a merchant of record requires.
 */

const SITE = resolve(import.meta.dirname, '../../../site');

/** site/board/ is the built web board (ADR-0017), not a hand-written page. */
const BUILT = new Set([join(SITE, 'board')]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (BUILT.has(path)) return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const pages = walk(SITE)
  .filter((f) => f.endsWith('.html'))
  .map((file) => ({
    file: relative(SITE, file),
    doc: new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html'),
  }));

/** The URLs an element loads: href/src, or every candidate in a srcset. */
function urlsOf(el: Element): string[] {
  const srcset = el.getAttribute('srcset');
  if (srcset !== null) return srcset.split(',').map((c) => c.trim().split(/\s+/)[0] ?? '');
  const url = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('poster');
  return url === null ? [] : [url];
}

function resolveInternal(href: string): string {
  const path = decodeURIComponent(href.split(/[?#]/)[0] ?? '');
  if (path === '' || path === '/') return join(SITE, 'index.html');
  const target = join(SITE, path);
  return path.endsWith('/') ? join(target, 'index.html') : target;
}

describe('rolestash.com static site', () => {
  it('has the pages the store listing and merchant of record link to', () => {
    const files = pages.map((p) => p.file).sort();
    expect(files).toEqual(
      [
        '404.html',
        'auth/google/index.html',
        'australia/index.html',
        'changelog/index.html',
        'compare/huntr/index.html',
        'compare/teal/index.html',
        'guides/track-job-applications/index.html',
        'index.html',
        'job-sites/index.html',
        'known-issues/index.html',
        'notify/check-email/index.html',
        'notify/confirmed/index.html',
        'notify/problem/index.html',
        'notify/unsubscribed/index.html',
        'pay/index.html',
        'pay/success/index.html',
        'pricing/index.html',
        'privacy/index.html',
        'private-job-tracker/index.html',
        'refunds/index.html',
        'sitemap/index.html',
        'support/index.html',
        'terms/index.html',
        'welcome/index.html',
      ].sort(),
    );
  });

  it.each(pages)(
    '$file loads nothing from other origins and has no inline code',
    ({ file, doc }) => {
      // JSON-LD is data, never executed (and the CSP doesn't apply to it).
      for (const data of doc.querySelectorAll('script[type="application/ld+json"]'))
        expect(() => JSON.parse(data.textContent) as unknown).not.toThrow();
      const scripts = [...doc.querySelectorAll('script:not([type="application/ld+json"])')];
      for (const script of scripts) expect(script.textContent.trim()).toBe('');
      // Every page loads only the light/dark switch, first in <head> so a saved
      // theme applies before paint. Checkout and pricing add Paddle.js and our
      // module; the Google hand-off adds its forwarder.
      const THEME = '/assets/theme.js';
      const allowed: Record<string, string[]> = {
        'pay/index.html': [THEME, 'https://cdn.paddle.com/paddle/v2/paddle.js', '/assets/pay.js'],
        'pricing/index.html': [
          THEME,
          'https://cdn.paddle.com/paddle/v2/paddle.js',
          '/assets/pricing.js',
        ],
        'auth/google/index.html': [THEME, '/assets/auth-google.js'],
      };
      expect(scripts.map((el) => el.getAttribute('src'))).toEqual(allowed[file] ?? [THEME]);
      expect(doc.head.querySelector('script')?.getAttribute('src')).toBe(THEME);
      expect(doc.querySelectorAll('[style], style')).toHaveLength(0);
      const refs = [
        ...doc.querySelectorAll(
          'link[rel="stylesheet"], link[rel="preload"], img, source, video[poster]',
        ),
      ].flatMap(urlsOf);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(ref).toMatch(/^\//);
    },
  );

  describe('search', () => {
    const SITE_URL = 'https://rolestash.com';
    const indexable = pages.filter(
      ({ file, doc }) =>
        file !== '404.html' &&
        !(doc.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '').includes(
          'noindex',
        ),
    );
    const urlOf = (file: string) => `${SITE_URL}/${file.replace(/index\.html$/, '')}`;

    it('lists exactly the indexable pages in sitemap.xml, linked from robots.txt', () => {
      const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
      const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
      expect(locs).toEqual(indexable.map(({ file }) => urlOf(file)).sort());
      for (const [, date] of sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g))
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const robots = readFileSync(join(SITE, 'robots.txt'), 'utf8');
      expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
      expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
      expect(existsSync(join(SITE, 'llms.txt'))).toBe(true);
    });

    it.each(indexable)(
      '$file has a title, description, canonical and share card',
      ({ file, doc }) => {
        const meta = (key: string) =>
          doc
            .querySelector(`meta[name="${key}"], meta[property="${key}"]`)
            ?.getAttribute('content') ?? '';
        const title = doc.title.trim();
        expect(title.length, title).toBeGreaterThan(10);
        expect(title.length, title).toBeLessThanOrEqual(60);
        expect(meta('description').length).toBeGreaterThanOrEqual(70);
        expect(meta('description').length).toBeLessThanOrEqual(160);
        expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(urlOf(file));
        expect(meta('og:url')).toBe(urlOf(file));
        expect(meta('og:title')).toBe(title);
        expect(meta('og:image')).toMatch(/^https:\/\/rolestash\.com\/assets\//);
        expect(doc.querySelectorAll('script[type="application/ld+json"]').length).toBeGreaterThan(
          0,
        );
      },
    );

    it('keeps unique titles and descriptions', () => {
      const titles = indexable.map(({ doc }) => doc.title.trim());
      const descriptions = indexable.map(({ doc }) =>
        doc.querySelector('meta[name="description"]')?.getAttribute('content'),
      );
      expect(new Set(titles).size).toBe(titles.length);
      expect(new Set(descriptions).size).toBe(descriptions.length);
    });

    it.each(pages)('$file has one h1, headings in order, and alt text on images', ({ doc }) => {
      expect(doc.querySelectorAll('h1')).toHaveLength(1);
      const levels = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) =>
        Number(h.tagName[1]),
      );
      for (let i = 1; i < levels.length; i++)
        expect((levels[i] ?? 0) - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
      for (const img of doc.querySelectorAll('img')) expect(img.hasAttribute('alt')).toBe(true);
    });

    it('shows the changelog exactly as CHANGELOG.md says (npm run site:changelog)', async () => {
      const { renderChangelog, withChangelog } =
        await import('../../../scripts/build-site-changelog');
      const page = readFileSync(join(SITE, 'changelog/index.html'), 'utf8');
      const markdown = readFileSync(resolve(SITE, '../CHANGELOG.md'), 'utf8');
      const rebuilt = await format(withChangelog(page, renderChangelog(markdown)), {
        parser: 'html',
        ...(await resolveConfig(join(SITE, 'changelog/index.html'))),
      });
      expect(page).toBe(rebuilt);
    });

    it('keeps the 404 page and private pages out of search', () => {
      const notFound = pages.find((p) => p.file === '404.html')?.doc;
      expect(notFound?.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex',
      );
      expect(notFound?.querySelector('link[rel="canonical"]')).toBeNull();
      for (const file of ['pay/index.html', 'welcome/index.html', 'auth/google/index.html'])
        expect(indexable.map((p) => p.file)).not.toContain(file);
    });

    it('describes the homepage FAQ in structured data exactly as shown', () => {
      const home = pages.find((p) => p.file === 'index.html')?.doc;
      if (!home) throw new Error('index.html');
      const data = JSON.parse(
        home.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
      ) as { '@graph': { '@type': string; mainEntity?: { name: string }[] }[] };
      const faq = data['@graph'].find((n) => n['@type'] === 'FAQPage');
      const shown = [...home.querySelectorAll('#faq summary')].map((s) => s.textContent.trim());
      expect(faq?.mainEntity?.map((q) => q.name)).toEqual(shown);
    });
  });

  it.each(pages)('$file has working internal links and assets', ({ doc }) => {
    const refs = [
      ...doc.querySelectorAll(
        'a[href], link[href], img[src], img[srcset], source[srcset], source[src], video[poster]',
      ),
    ]
      .flatMap(urlsOf)
      .filter((v) => v.startsWith('/'));
    for (const ref of refs) expect(existsSync(resolveInternal(ref)), ref).toBe(true);
  });

  it('uses the same header and footer on every page', () => {
    const shared = (sel: string) =>
      new Set(pages.map(({ doc }) => doc.querySelector(sel)?.outerHTML ?? 'missing'));
    expect(shared('header.site-header').size).toBe(1);
    expect(shared('footer.site-footer').size).toBe(1);
  });

  it('has the header and footer stamped by npm run site:chrome', () => {
    const landing = readFileSync(join(SITE, 'index.html'), 'utf8');
    for (const { file } of pages) {
      const html = readFileSync(join(SITE, file), 'utf8');
      expect(stampChrome(html, landing), file).toBe(html);
    }
  });

  it('shares a small JPEG link preview that chat apps, WhatsApp included, can show', () => {
    const meta = (doc: Document, key: string) =>
      doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content');
    for (const file of [
      'index.html',
      'privacy/index.html',
      'terms/index.html',
      'support/index.html',
    ]) {
      const doc = pages.find((p) => p.file === file)?.doc;
      if (!doc) throw new Error(file);
      const image = meta(doc, 'og:image') ?? '';
      expect(image, file).toMatch(/^https:\/\/rolestash\.com\/assets\/.+\.(png|jpg)$/);
      const path = join(SITE, new URL(image).pathname);
      expect(existsSync(path)).toBe(true);
      // WhatsApp drops preview images much over 300 KB.
      expect(statSync(path).size).toBeLessThan(300_000);
      expect(meta(doc, 'og:image:secure_url')).toBe(image);
      expect(meta(doc, 'twitter:image')).toBe(image);
      expect(meta(doc, 'og:image:width')).toBe('1200');
      expect(meta(doc, 'og:image:height')).toBe('630');
      expect(meta(doc, 'og:title')).toBeTruthy();
      expect(meta(doc, 'twitter:card')).toBe('summary_large_image');
    }
  });

  it('plays the hero film from our own small files, always muted, with the board pictures as fallback', () => {
    const home = pages.find((p) => p.file === 'index.html')?.doc;
    if (!home) throw new Error('index.html missing');
    // A landscape cut, and a vertical cut that CSS shows on small screens.
    const wide = home.querySelector('.showcase .film-wide video');
    const tall = home.querySelector('.showcase .film-tall video');
    if (!wide || !tall) throw new Error('hero film missing');
    expect(Number(wide.getAttribute('width'))).toBeGreaterThan(Number(wide.getAttribute('height')));
    expect(Number(tall.getAttribute('height'))).toBeGreaterThan(Number(tall.getAttribute('width')));
    // Always silent: no controls to unmute it, and no buttons.
    expect(home.querySelectorAll('.showcase button')).toHaveLength(0);
    for (const video of [wide, tall]) {
      // Muted, inline and looping so it may autoplay; only metadata until it plays.
      for (const attr of ['muted', 'playsinline', 'loop'])
        expect(video.hasAttribute(attr), attr).toBe(true);
      expect(video.hasAttribute('controls')).toBe(false);
      expect(video.hasAttribute('autoplay')).toBe(false); // theme.js plays it, never with reduced motion
      expect(video.getAttribute('preload')).toBe('metadata');
      expect(video.getAttribute('width')).toMatch(/^\d+$/);
      expect(video.getAttribute('height')).toMatch(/^\d+$/);
      const files = [
        video.getAttribute('poster') ?? '',
        ...[...video.querySelectorAll('source')].map((s) => s.getAttribute('src') ?? ''),
      ];
      expect(files).toHaveLength(3);
      for (const file of files) {
        expect(file).toMatch(/^\/assets\//);
        // Keep the page light: each encode under 4 MB, the poster under 150 KB.
        expect(statSync(join(SITE, file)).size).toBeLessThan(
          file.endsWith('.webp') ? 150_000 : 4_000_000,
        );
      }
    }
    expect(
      home.querySelectorAll('.showcase picture.shot-light, .showcase picture.shot-dark'),
    ).toHaveLength(2);
    // The site-wide CSP has to allow our own media, and nothing else.
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    const siteCsp = /^\/\*\n {2}Content-Security-Policy: (.+)$/m.exec(headers)?.[1] ?? '';
    expect(siteCsp).toContain("media-src 'self';");
  });

  it('gives every image explicit dimensions so nothing shifts as it loads', () => {
    for (const { file, doc } of pages)
      for (const img of doc.querySelectorAll('img, picture > source')) {
        expect(img.getAttribute('width'), `${file}: ${img.outerHTML}`).toMatch(/^\d+$/);
        expect(img.getAttribute('height'), `${file}: ${img.outerHTML}`).toMatch(/^\d+$/);
      }
  });

  it('states the merchant of record and support contact the payment provider requires', () => {
    const text = (file: string) =>
      pages.find((p) => p.file === file)?.doc.body.textContent.replace(/\s+/g, ' ') ?? '';
    expect(text('terms/index.html')).toContain(
      'Paddle.com is the Merchant of Record for all our orders',
    );
    for (const file of ['terms/index.html', 'privacy/index.html', 'refunds/index.html'])
      expect(text(file)).toContain('support@rolestash.com');
    expect(text('index.html')).toContain('US$7');
  });

  it('posts the launch-list form only to our own function, which the CSP allows', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    const siteWide = headers.slice(0, headers.indexOf('/assets/*'));
    const forms = pages.flatMap(({ file, doc }) =>
      [...doc.querySelectorAll('form')].map((f) => ({ file, form: f })),
    );
    expect(forms.map((f) => f.file)).toEqual(['index.html']);
    const action = forms[0]?.form.getAttribute('action') ?? '';
    expect(action).toMatch(/^https:\/\/[a-z]+\.supabase\.co\/functions\/v1\/launch-list$/);
    expect(forms[0]?.form.getAttribute('method')).toBe('post');
    expect(siteWide).toContain(`form-action 'self' ${action};`);
    // The redirect targets of the launch-list function exist.
    const fn = readFileSync(resolve(SITE, '../supabase/functions/_shared/launch-list.ts'), 'utf8');
    for (const [, path] of fn.matchAll(/siteUrl\}(\/notify\/[a-z-]+\/)/g))
      expect(existsSync(resolveInternal(path ?? '')), path).toBe(true);
  });

  it('keeps scripts Cloudflare injects (JS detections, Web Analytics beacon) inert', () => {
    // Cloudflare can add an inline bot-detection script and a
    // static.cloudflareinsights.com beacon to our HTML at the edge. Our CSPs
    // block both, which is what keeps "no analytics" true. Never allow inline
    // scripts, eval, or Cloudflare's script hosts on any page.
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    const policies = headers
      .split('\n')
      .filter((line) => /^\s+Content-Security-Policy:/.test(line))
      .map((line) => line.replace(/^\s+Content-Security-Policy:\s*/, ''));
    expect(policies.length).toBeGreaterThanOrEqual(3);
    for (const policy of policies) {
      const scriptSrc =
        /script-src([^;]*)/.exec(policy)?.[1] ?? /default-src([^;]*)/.exec(policy)?.[1];
      expect(scriptSrc, policy).toBeDefined();
      expect(scriptSrc).not.toMatch(
        /'unsafe-inline'|'unsafe-eval'|cloudflareinsights|\*(?!\.paddle\.com)|https:(?!\/\/)/,
      );
      expect(policy).not.toMatch(/cloudflareinsights|cdn-cgi/);
    }
  });

  it('gives the web board its own strict CSP, talking only to our Supabase project', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    const board = headers.slice(headers.indexOf('/board/*'));
    expect(board).toMatch(/^\s+! Content-Security-Policy$/m);
    const csp = /Content-Security-Policy: (.+)$/m.exec(board)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toMatch(/connect-src https:\/\/[a-z]+\.supabase\.co;/);
    expect(csp).toContain("frame-ancestors 'none'");
    const env = readFileSync(resolve(SITE, '../.env.staging'), 'utf8');
    const url = /^WXT_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim() ?? 'missing';
    expect(csp).toContain(`connect-src ${url};`);
  });

  it('keeps its security headers', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain('Strict-Transport-Security');
  });

  it('deploys as an assets-only Worker that never touches routes or adds public URLs', () => {
    const raw = readFileSync(resolve(SITE, '../infra/site.wrangler.jsonc'), 'utf8');
    const config = JSON.parse(
      // JSONC → JSON: drop line comments and trailing commas.
      raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'),
    ) as Record<string, unknown>;
    expect(config.name).toBe('rolestash-v001');
    expect(config.assets).toMatchObject({ directory: '../site' });
    expect(config.main).toBeUndefined(); // no code, only static files
    expect(config.routes).toBeUndefined();
    expect(config.route).toBeUndefined();
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it('Google hand-off forwards only to allow-listed Rolestash extensions', () => {
    const code = readFileSync(join(SITE, 'assets/auth-google.js'), 'utf8');
    // Run the page script in a sandbox without `location`/`document`, so it
    // only defines forwardTarget().
    const forwardTarget = runInNewContext(`${code}; forwardTarget`, {
      URLSearchParams,
      atob,
      JSON,
    }) as (hash: string) => string | null;
    const state = (e: string) =>
      btoa(JSON.stringify({ e, s: 'x' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const ours = 'bdajnmkjahhphadpdbbkibljcheonejp';
    expect(forwardTarget(`#id_token=t&state=${state(ours)}`)).toBe(
      `https://${ours}.chromiumapp.org/#id_token=t&state=${state(ours)}`,
    );
    // The web board (ADR-0017) gets its sign-ins on this same site.
    expect(forwardTarget(`#id_token=t&state=${state('web')}`)).toBe(
      `/board/#id_token=t&state=${state('web')}`,
    );
    // Errors are forwarded too, so the extension can report a cancelled sign-in.
    expect(forwardTarget(`#error=access_denied&state=${state(ours)}`)).toContain(
      `${ours}.chromiumapp.org/#error=access_denied`,
    );
    for (const hash of [
      `#id_token=t&state=${state('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')}`, // another extension
      `#id_token=t&state=${state('evil.com/x')}`,
      '#id_token=t',
      '#id_token=t&state=%%%',
      '',
    ])
      expect(forwardTarget(hash)).toBeNull();
  });

  it('allows the extension ID pinned by the manifest key in wxt.config.ts', async () => {
    const config = readFileSync(resolve(SITE, '../wxt.config.ts'), 'utf8');
    const key = /DEV_EXTENSION_KEY =\s*'([^']+)'/.exec(config)?.[1] ?? '';
    const der = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
    const id = [...hash.slice(0, 16)]
      .map((b) => `${HEX_TO_ID[b >> 4] ?? ''}${HEX_TO_ID[b & 15] ?? ''}`)
      .join('');
    expect(id).toBe('bdajnmkjahhphadpdbbkibljcheonejp');
    expect(readFileSync(join(SITE, 'assets/auth-google.js'), 'utf8')).toContain(`'${id}'`);
  });

  it('lists the same extension IDs in the Google forwarder and the web board', async () => {
    const { ROLESTASH_EXTENSION_IDS } = await import('../../../src/services/web-handoff');
    const code = readFileSync(join(SITE, 'assets/auth-google.js'), 'utf8');
    const listed = /ALLOWED_EXTENSION_IDS = (\[[^\]]*\])/.exec(code)?.[1] ?? '[]';
    const ids = [...listed.matchAll(/'([a-p]{32})'/g)].map((m) => m[1]);
    expect(ids).toEqual([...ROLESTASH_EXTENSION_IDS]);
  });

  it('keeps the Google hand-off page private: own script only, no referrer, not cached', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    const auth = headers.slice(headers.indexOf('/auth/*'));
    expect(auth).toMatch(/^\s+! Content-Security-Policy$/m);
    expect(auth).toMatch(/^\s+! Referrer-Policy$/m);
    expect(auth).toContain("script-src 'self';");
    expect(auth).toContain('Referrer-Policy: no-referrer');
    expect(auth).toContain('Cache-Control: no-store');
  });

  it('scopes the Paddle CSP to /pay/ and /pricing/, replacing the site-wide one', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    for (const path of ['/pay/*', '/pricing/*']) {
      const block = headers.slice(headers.indexOf(path)).split('\n\n')[0] ?? '';
      expect(block).toMatch(/^\s+! Content-Security-Policy$/m);
      expect(block).toContain("script-src 'self' https://cdn.paddle.com;");
      expect(block).toContain('frame-src https://buy.paddle.com https://sandbox-buy.paddle.com;');
    }
    expect(headers.slice(0, headers.indexOf('/pay/*'))).not.toContain('paddle');
    // Public since launch: /pricing/ is in the nav and in search results.
    const pricing = headers.slice(headers.indexOf('/pricing/*')).split('\n\n')[0] ?? '';
    expect(pricing).not.toContain('X-Robots-Tag');
  });

  it('links every "Add to Chrome" to the one store listing', () => {
    const store = /^https:\/\/chromewebstore\.google\.com\/detail\/rolestash\/[^/?#]+$/;
    const links = [
      ...pages.flatMap(({ doc }) =>
        // Comparison pages cite other extensions' listings under Sources.
        [...doc.querySelectorAll('a[href*="chromewebstore"]')]
          .filter((a) => !a.closest('.sources'))
          .map((a) => a.getAttribute('href')),
      ),
      ...readFileSync(join(SITE, 'assets/pricing.js'), 'utf8').matchAll(
        /'(https:\/\/chromewebstore[^']*)'/g,
      ),
    ].map((l) => (Array.isArray(l) ? l[1] : l));
    expect(links.length).toBeGreaterThan(3);
    expect(new Set(links).size).toBe(1);
    expect(links[0]).toMatch(store);
    // Nothing still points at the pre-launch "Notify me" form.
    // The changelog quotes past releases, so it may name them.
    for (const { file, doc } of pages.filter((p) => p.file !== 'changelog/index.html'))
      expect(doc.body.textContent, file).not.toMatch(/Notify me at launch|Launching soon/);
  });

  it.each(pages)('$file loads ES-module scripts as modules', ({ doc }) => {
    // A classic <script> that uses `import` fails silently in the browser
    // (checkout on /pay/ once stayed stuck on "Opening secure checkout…").
    for (const script of doc.querySelectorAll('script[src^="/"]')) {
      const src = script.getAttribute('src') ?? '';
      const code = readFileSync(join(SITE, src.slice(1)), 'utf8');
      if (/^\s*(import|export)\s/m.test(code))
        expect(script.getAttribute('type'), src).toBe('module');
    }
  });

  it('never opens checkout on /pricing/: buyers sign in on the board first (ADR-0027)', () => {
    // A checkout opened in the browser can claim any account in custom_data,
    // and the webhook no longer matches purchases by the email typed there.
    const source = readFileSync(join(SITE, 'assets/pricing.js'), 'utf8');
    expect(source).not.toMatch(/Checkout\.open|customData|customer:/);
    expect(source).toContain('/board/?checkout=');
  });

  it('reads Paddle settings from one config that refuses mismatched environments', async () => {
    const source = readFileSync(join(SITE, 'assets/paddle-config.js'), 'utf8');
    for (const script of ['pay.js', 'pricing.js'])
      expect(readFileSync(join(SITE, 'assets', script), 'utf8')).toContain(
        "from './paddle-config.js'",
      );
    interface PaddleConfigModule {
      PADDLE: {
        environment: string;
        token: string;
        prices: Record<string, Record<string, string>>;
      };
      initPaddle: (options: object) => unknown;
    }
    const { PADDLE, initPaddle } = (await import(
      join(SITE, 'assets/paddle-config.js')
    )) as PaddleConfigModule;
    expect(['sandbox', 'production']).toContain(PADDLE.environment);
    expect(PADDLE.token.startsWith(PADDLE.environment === 'sandbox' ? 'test_' : 'live_')).toBe(
      true,
    );
    for (const tier of Object.values(PADDLE.prices))
      for (const id of Object.values(tier)) expect(id).toMatch(/^pri_[a-z0-9]{26}$/);
    expect(source).not.toMatch(/apiKey|pdl_live|pdl_sdbx/i);
    // A live token with the sandbox environment (or the reverse) stops loudly.
    const saved = PADDLE.token;
    const live = PADDLE.environment === 'production';
    PADDLE.token = live ? 'test_x' : 'live_x';
    expect(() => initPaddle({})).toThrow(live ? /must start with live_/ : /must start with test_/);
    PADDLE.token = saved;
  });
});
