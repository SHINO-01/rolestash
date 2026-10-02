import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
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
  const url = el.getAttribute('href') ?? el.getAttribute('src');
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
        'index.html',
        'notify/check-email/index.html',
        'notify/confirmed/index.html',
        'notify/problem/index.html',
        'notify/unsubscribed/index.html',
        'pay/index.html',
        'pay/success/index.html',
        'pricing/index.html',
        'privacy/index.html',
        'refunds/index.html',
        'support/index.html',
        'terms/index.html',
        'welcome/index.html',
      ].sort(),
    );
  });

  it.each(pages)(
    '$file loads nothing from other origins and has no inline code',
    ({ file, doc }) => {
      const scripts = [...doc.querySelectorAll('script')];
      for (const script of scripts) expect(script.textContent.trim()).toBe('');
      // Only checkout and pricing (Paddle.js + our module) and the Google hand-off have scripts.
      const allowed: Record<string, string[]> = {
        'pay/index.html': ['https://cdn.paddle.com/paddle/v2/paddle.js', '/assets/pay.js'],
        'pricing/index.html': ['https://cdn.paddle.com/paddle/v2/paddle.js', '/assets/pricing.js'],
        'auth/google/index.html': ['/assets/auth-google.js'],
      };
      expect(scripts.map((el) => el.getAttribute('src'))).toEqual(allowed[file] ?? []);
      expect(doc.querySelectorAll('[style], style')).toHaveLength(0);
      const refs = [
        ...doc.querySelectorAll('link[rel="stylesheet"], link[rel="preload"], img, source'),
      ].flatMap(urlsOf);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(ref).toMatch(/^\//);
    },
  );

  it.each(pages)('$file has working internal links and assets', ({ doc }) => {
    const refs = [
      ...doc.querySelectorAll('a[href], link[href], img[src], img[srcset], source[srcset]'),
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

  it('shares with a PNG link preview that apps without WebP support can show', () => {
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
      expect(image, file).toMatch(/^https:\/\/rolestash\.com\/assets\/.+\.png$/);
      expect(existsSync(join(SITE, new URL(image).pathname))).toBe(true);
      expect(meta(doc, 'og:image:width')).toBe('1200');
      expect(meta(doc, 'og:image:height')).toBe('630');
      expect(meta(doc, 'og:title')).toBeTruthy();
      expect(meta(doc, 'twitter:card')).toBe('summary_large_image');
    }
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
    expect(JSON.parse(listed.replace(/'/g, '"')) as string[]).toEqual([...ROLESTASH_EXTENSION_IDS]);
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
    // Out of search results until launch.
    expect(headers.slice(headers.indexOf('/pricing/*'))).toMatch(/X-Robots-Tag: noindex/);
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
