/**
 * An API key as stored in a Worker secret, cleaned of what a paste can add:
 * spaces and line breaks, quotes, or a "Bearer " prefix. Paddle answers any
 * of them with authentication_malformed, Resend with HTTP 401.
 */
export function cleanKey(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}
