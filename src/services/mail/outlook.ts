import { graphFirstLook, graphToInput, type EmailInput, type GraphMessage } from '@/email/mailbox';
import { getJson, MailAuthError, MailUnavailableError, type MailClient } from './types';

/**
 * Outlook and Microsoft 365, read-only, through Microsoft Graph (ADR-0032).
 * A public client with PKCE: no secret in the extension. Microsoft gives a
 * refresh token (offline_access), so the board updates at browser startup
 * without a sign-in window.
 */

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';
export const OUTLOOK_SCOPES = 'openid offline_access User.Read Mail.Read';

export function outlookAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: input.redirectUri,
    scope: OUTLOOK_SCOPES,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

/** The authorization code from Microsoft's redirect, checked against this attempt's state. */
export function readOutlookRedirect(finalUrl: string, state: string): string {
  const query = new URL(finalUrl).searchParams;
  if (query.get('state') !== state) throw new MailAuthError('Unexpected sign-in response');
  if (query.get('error')) throw new MailAuthError(query.get('error') ?? 'Sign-in failed');
  const code = query.get('code');
  if (!code) throw new MailAuthError('No authorization code');
  return code;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

/** Exchanges a code (with its PKCE verifier) or a refresh token for tokens. */
export async function outlookToken(
  fetcher: typeof fetch,
  input: { clientId: string; redirectUri: string; now: number } & (
    { code: string; verifier: string } | { refreshToken: string }
  ),
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: OUTLOOK_SCOPES,
    ...('code' in input
      ? { grant_type: 'authorization_code', code: input.code, code_verifier: input.verifier }
      : { grant_type: 'refresh_token', refresh_token: input.refreshToken }),
  });
  let response: Response;
  try {
    response = await fetcher(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new MailUnavailableError(0);
  }
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  // invalid_grant: the refresh token was revoked or expired (90 days unused).
  if (response.status === 400 || response.status === 401) throw new MailAuthError(data.error);
  if (!response.ok || !data.access_token) throw new MailUnavailableError(response.status);
  return {
    accessToken: data.access_token,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    expiresAt: input.now + (data.expires_in ?? 3600) * 1000,
  };
}

export class OutlookClient implements MailClient {
  constructor(private readonly fetcher: typeof fetch) {}

  async address(token: string): Promise<string> {
    const me = await getJson<{ mail?: string | null; userPrincipalName?: string }>(
      this.fetcher,
      `${GRAPH}?$select=mail,userPrincipalName`,
      token,
    );
    const address = me.mail ?? me.userPrincipalName;
    if (!address) throw new MailAuthError('No Outlook address');
    return address;
  }

  async list(token: string, since: Date, limit: number, _companies: readonly string[]) {
    const params = new URLSearchParams({
      $select: 'id,subject,from,receivedDateTime',
      $filter: `receivedDateTime ge ${since.toISOString()}`,
      $orderby: 'receivedDateTime asc',
      $top: String(limit),
    });
    const page = await getJson<{ value?: GraphMessage[] }>(
      this.fetcher,
      `${GRAPH}/mailFolders/inbox/messages?${params.toString()}`,
      token,
    );
    return (page.value ?? []).map((m) => ({
      id: m.id,
      receivedAt: m.receivedDateTime ?? new Date().toISOString(),
      look: graphFirstLook(m),
    }));
  }

  async read(token: string, id: string): Promise<EmailInput | undefined> {
    const message = await getJson<GraphMessage>(
      this.fetcher,
      `${GRAPH}/messages/${encodeURIComponent(id)}?$select=id,subject,from,receivedDateTime,internetMessageId,body`,
      token,
    );
    return graphToInput(message);
  }
}
