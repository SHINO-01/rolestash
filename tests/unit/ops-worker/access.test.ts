import { allowedEmailList, verifyAccess } from '../../../infra/ops-worker/src/access';
import { handle } from '../../../infra/ops-worker/src/app';

const TEAM = 'rolestash.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW = new Date('2026-10-05T00:00:00Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const encJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function keyPair() {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

async function sign(key: CryptoKey, payload: Record<string, unknown>, kid = 'k1') {
  const unsigned = `${encJson({ alg: 'RS256', kid })}.${encJson(payload)}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  );
  return `${unsigned}.${b64url(sig)}`;
}

const good = (extra: Record<string, unknown> = {}) => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: SECONDS + 600,
  nbf: SECONDS - 10,
  iat: SECONDS - 60,
  email: 'Owner@Example.com',
  ...extra,
});

let pair: CryptoKeyPair;
let certs: typeof fetch;
const config = { teamDomain: TEAM, audience: AUD, allowedEmails: 'owner@example.com' };
const req = (token?: string) =>
  new Request('https://operations.rolestash.com/', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });

beforeAll(async () => {
  pair = await keyPair();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  certs = ((url: string) =>
    Promise.resolve(
      url === `https://${TEAM}/cdn-cgi/access/certs`
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response('nope', { status: 404 }),
    )) as typeof fetch;
});

describe('Cloudflare Access check', () => {
  it('lets in an allowed email with a valid token', async () => {
    const token = await sign(pair.privateKey, good());
    expect(await verifyAccess(req(token), config, certs, NOW)).toEqual({
      ok: true,
      email: 'owner@example.com',
    });
  });

  it('fails closed without configuration or a token', async () => {
    const token = await sign(pair.privateKey, good());
    for (const missing of [
      { ...config, teamDomain: '' },
      { ...config, audience: undefined },
      { ...config, allowedEmails: '' },
    ])
      expect(await verifyAccess(req(token), missing, certs, NOW)).toMatchObject({
        reason: 'not_configured',
      });
    expect(await verifyAccess(req(), config, certs, NOW)).toMatchObject({ reason: 'no_token' });
    expect(await verifyAccess(req('a.b'), config, certs, NOW)).toMatchObject({
      reason: 'malformed',
    });
  });

  it('refuses the wrong audience, issuer, expiry or email', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ aud: ['other'] }, 'wrong_audience'],
      [{ iss: 'https://evil.cloudflareaccess.com' }, 'wrong_issuer'],
      [{ exp: SECONDS - 1 }, 'expired'],
      [{ nbf: SECONDS + 3600 }, 'not_yet_valid'],
      [{ email: 'someone@example.com' }, 'not_allowed'],
      // Signed in more than an hour ago, even if Access still says the session is valid.
      [{ iat: SECONDS - 3601, exp: SECONDS + 3600 }, 'login_too_old'],
      [{ iat: undefined }, 'login_too_old'],
    ];
    for (const [extra, reason] of cases) {
      const token = await sign(pair.privateKey, good(extra));
      expect(await verifyAccess(req(token), config, certs, NOW)).toMatchObject({ reason });
    }
  });

  it('refuses a token signed by another key or with an unknown key id', async () => {
    const other = await keyPair();
    expect(
      await verifyAccess(req(await sign(other.privateKey, good())), config, certs, NOW),
    ).toMatchObject({ reason: 'bad_signature' });
    expect(
      await verifyAccess(req(await sign(pair.privateKey, good(), 'k2')), config, certs, NOW),
    ).toMatchObject({ reason: 'unknown_key' });
  });

  it("refuses when the certificates can't be fetched", async () => {
    const token = await sign(pair.privateKey, good());
    const down = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    expect(await verifyAccess(req(token), config, down, NOW)).toMatchObject({
      reason: 'certs_unavailable',
    });
  });

  it('parses the allow-list', () => {
    expect(allowedEmailList(' A@b.c, nope ,d@e.f')).toEqual(['a@b.c', 'd@e.f']);
    expect(allowedEmailList(undefined)).toEqual([]);
  });
});

describe('the dashboard request handler', () => {
  const env = {
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    OWNER_EMAILS: 'owner@example.com',
  };

  it('returns 403 with strict headers without Access', async () => {
    const response = await handle(req(), env, { fetch: certs, now: NOW });
    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('offers a fresh sign-in when the Access sign-in is over an hour old', async () => {
    const token = await sign(pair.privateKey, good({ iat: SECONDS - 2 * 60 * 60 }));
    const response = await handle(req(token), env, { fetch: certs, now: NOW });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('href="/cdn-cgi/access/logout"');
    // Styled like the dashboard: the stylesheet loads without a fresh sign-in.
    const css = await handle(new Request('https://operations.rolestash.com/ops.css'), env, {
      fetch: certs,
      now: NOW,
    });
    expect(css.headers.get('Content-Type')).toContain('text/css');
    expect(await css.text()).toContain('.gate{');
  });

  it('renders the page, escaped, with every panel "not set up" when no tokens exist', async () => {
    const token = await sign(pair.privateKey, good());
    const response = await handle(req(token), env, { fetch: certs, now: NOW });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Rolestash ops');
    expect(html).toContain('owner@example.com');
    // Panels without a token collapse into one line instead of a card each.
    expect(html).toMatch(/Not set up: [^<]*Usage \(Supabase\)/);
    expect(html).not.toContain('class="card"><h2>Revenue');
    expect(html).not.toMatch(/<script/i);
  });

  it('serves its stylesheet and nothing else', async () => {
    const token = await sign(pair.privateKey, good());
    const at = (path: string, method = 'GET') =>
      handle(
        new Request(`https://operations.rolestash.com${path}`, {
          method,
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        env,
        { fetch: certs, now: NOW },
      );
    expect((await at('/ops.css')).headers.get('Content-Type')).toContain('text/css');
    expect((await at('/admin')).status).toBe(404);
    expect((await at('/', 'POST')).status).toBe(405);
    // Changes need the admin secret, which this environment doesn't have.
    expect((await at('/do', 'POST')).status).toBe(403);
  });
});
