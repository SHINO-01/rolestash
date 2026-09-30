import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * rolestash.com is static HTML in site/ (see docs/guides/website.md). These
 * checks keep the site's promises: no third-party requests, a CSP-compatible
 * page (no inline styles or scripts), working internal links, and the legal
 * pages a merchant of record requires.
 */

const SITE = resolve(import.meta.dirname, '../../../site');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const pages = walk(SITE)
  .filter((f) => f.endsWith('.html'))
  .map((file) => ({
    file: relative(SITE, file),
    doc: new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html'),
  }));

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
        'index.html',
        'pay/index.html',
        'pay/success/index.html',
        'privacy/index.html',
        'refunds/index.html',
        'support/index.html',
        'terms/index.html',
      ].sort(),
    );
  });

  it.each(pages)(
    '$file loads nothing from other origins and has no inline code',
    ({ file, doc }) => {
      const scripts = [...doc.querySelectorAll('script')];
      for (const script of scripts) expect(script.textContent.trim()).toBe('');
      // Checkout is the only page with scripts: Paddle.js and our own pay.js.
      expect(scripts.map((el) => el.getAttribute('src'))).toEqual(
        file === 'pay/index.html'
          ? ['https://cdn.paddle.com/paddle/v2/paddle.js', '/assets/pay.js']
          : [],
      );
      expect(doc.querySelectorAll('[style], style')).toHaveLength(0);
      const refs = [
        ...doc.querySelectorAll('link[rel="stylesheet"], link[rel="preload"], img, source'),
      ]
        .map((el) => el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('srcset'))
        .filter((v): v is string => v !== null);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(ref).toMatch(/^\//);
    },
  );

  it.each(pages)('$file has working internal links and assets', ({ doc }) => {
    const refs = [...doc.querySelectorAll('a[href], link[href], img[src], source[srcset]')]
      .map((el) => el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('srcset'))
      .filter((v): v is string => v?.startsWith('/') === true);
    for (const ref of refs) expect(existsSync(resolveInternal(ref)), ref).toBe(true);
  });

  it('uses the same header and footer on every page', () => {
    const shared = (sel: string) =>
      new Set(pages.map(({ doc }) => doc.querySelector(sel)?.outerHTML ?? 'missing'));
    expect(shared('header.site-header').size).toBe(1);
    expect(shared('footer.site-footer').size).toBe(1);
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

  it('keeps its security headers', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain('Strict-Transport-Security');
  });

  it('scopes the Paddle CSP to /pay/ and replaces, not adds to, the site-wide one', () => {
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    const pay = headers.slice(headers.indexOf('/pay/*'));
    expect(pay).toMatch(/^\s+! Content-Security-Policy$/m);
    expect(pay).toContain("script-src 'self' https://cdn.paddle.com;");
    expect(pay).toContain('frame-src https://buy.paddle.com https://sandbox-buy.paddle.com;');
    expect(headers.slice(0, headers.indexOf('/pay/*'))).not.toContain('paddle');
  });
});
