/**
 * Cloudflare Access check for the operations dashboard (ADR-0026).
 *
 * Access sits in front of operations.rolestash.com and adds a signed JWT to
 * every request it lets through (`Cf-Access-Jwt-Assertion`). The Worker
 * verifies it again, so a request that reaches the Worker any other way is
 * refused. Fails closed: missing configuration means no one gets in.
 */

export interface AccessConfig {
  /** e.g. `rolestash.cloudflareaccess.com` (Zero Trust → Settings → Custom pages). */
  teamDomain: string | undefined;
  /** The Access application's "Application Audience (AUD) Tag". */
  audience: string | undefined;
  /** Comma-separated emails allowed in (a Worker secret, not in the repo). */
  allowedEmails: string | undefined;
}

export type AccessResult = { ok: true; email: string } | { ok: false; reason: string };

interface Jwk extends JsonWebKey {
  kid?: string;
}

const decoder = new TextDecoder();

function base64UrlDecode(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJson(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(decoder.decode(base64UrlDecode(part)));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The configured emails, lower-cased; empty if none. */
export function allowedEmailList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

/** Verifies the Access JWT on a request. Never throws. */
export async function verifyAccess(
  request: Request,
  config: AccessConfig,
  fetchFn: typeof fetch,
  now: Date,
): Promise<AccessResult> {
  const allowed = allowedEmailList(config.allowedEmails);
  if (!config.teamDomain || !config.audience || allowed.length === 0)
    return { ok: false, reason: 'not_configured' };

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, reason: 'no_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h = '', p = '', s = ''] = parts;
  const header = parseJson(h);
  const payload = parseJson(p);
  if (!header || !payload || header.alg !== 'RS256') return { ok: false, reason: 'malformed' };

  let keys: Jwk[];
  try {
    const response = await fetchFn(`https://${config.teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) return { ok: false, reason: 'certs_unavailable' };
    keys = ((await response.json()) as { keys?: Jwk[] }).keys ?? [];
  } catch {
    return { ok: false, reason: 'certs_unavailable' };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown_key' };

  let valid: boolean;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const seconds = Math.floor(now.getTime() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.audience)) return { ok: false, reason: 'wrong_audience' };
  if (payload.iss !== `https://${config.teamDomain}`) return { ok: false, reason: 'wrong_issuer' };
  if (typeof payload.exp !== 'number' || payload.exp <= seconds)
    return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60)
    return { ok: false, reason: 'not_yet_valid' };

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!allowed.includes(email)) return { ok: false, reason: 'not_allowed' };
  return { ok: true, email };
}
