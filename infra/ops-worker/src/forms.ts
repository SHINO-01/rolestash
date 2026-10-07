/**
 * Form tokens for the dashboard's actions (ADR-0037). Every form carries
 * `_token`: the time it was made and an HMAC of the signed-in email, that
 * time, and the fields it covers, with the Worker's admin secret. A token is
 * good for an hour, for that person, and only for those fields, so a
 * confirmation page can't be replayed with other values, and another site
 * can't forge a request even if it could reach the Worker.
 */

export const FORM_MAX_AGE_SECONDS = 60 * 60;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const canonical = (email: string, at: number, fields: Record<string, string>) =>
  JSON.stringify([
    'ops-form-v1',
    email.toLowerCase(),
    at,
    Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);

export async function signForm(
  secret: string,
  email: string,
  now: Date,
  fields: Record<string, string>,
): Promise<string> {
  const at = Math.floor(now.getTime() / 1000);
  return `${String(at)}.${await hmacHex(secret, canonical(email, at, fields))}`;
}

export async function verifyForm(
  secret: string,
  email: string,
  now: Date,
  token: string,
  fields: Record<string, string>,
): Promise<boolean> {
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const at = Number(match[1]);
  const age = Math.floor(now.getTime() / 1000) - at;
  if (age < -60 || age > FORM_MAX_AGE_SECONDS) return false;
  const expected = await hmacHex(secret, canonical(email, at, fields));
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ (match[2] ?? '').charCodeAt(i);
  return diff === 0;
}
