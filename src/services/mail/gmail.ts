import { gmailFirstLook, gmailToInput, type EmailInput, type GmailMessage } from '@/email/mailbox';
import { getJson, MailAuthError, type MailClient } from './types';

/**
 * Gmail, read-only (ADR-0032). Google gives browser apps short-lived access
 * tokens and no refresh token, so the extension renews silently through the
 * user's Google session (`prompt=none`) at browser startup and when a token
 * runs out; if that session is gone, the user connects again.
 */

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/**
 * Google's restricted-scope verification of `gmail.readonly`
 * (docs/guides/gmail-verification.md). Until it's approved, Google shows
 * every user an "unverified app" warning, so release builds don't offer
 * Gmail at all; staging, development and E2E builds keep it for testing and
 * the review video. Set to true, and release, once Google approves.
 */
export const GMAIL_VERIFIED = false;

/** Whether this build offers "Connect Gmail" (given a client ID). */
export function gmailOffered(mode: string, verified: boolean = GMAIL_VERIFIED): boolean {
  return verified || mode !== 'production';
}
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function gmailAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Renew without showing anything (the user's Google session must exist). */
  silent?: boolean;
  /** The connected address, so a renewal picks the same account. */
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'token',
    redirect_uri: input.redirectUri,
    scope: GMAIL_SCOPE,
    state: input.state,
    include_granted_scopes: 'true',
    prompt: input.silent ? 'none' : 'consent select_account',
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

/** The access token from Google's redirect, checked against this attempt's state. */
export function readGmailRedirect(
  finalUrl: string,
  state: string,
  now: number,
): { accessToken: string; expiresAt: number } {
  const fragment = new URLSearchParams(new URL(finalUrl).hash.slice(1));
  if (fragment.get('state') !== state) throw new MailAuthError('Unexpected sign-in response');
  if (fragment.get('error')) throw new MailAuthError(fragment.get('error') ?? 'Sign-in failed');
  const token = fragment.get('access_token');
  const scopes = (fragment.get('scope') ?? '').split(' ');
  if (!token) throw new MailAuthError('No access token');
  // People can untick the Gmail permission on Google's screen.
  if (!scopes.includes(GMAIL_SCOPE)) throw new MailAuthError('Gmail access was not allowed');
  const seconds = Number(fragment.get('expires_in') ?? '3600');
  return {
    accessToken: token,
    expiresAt: now + (Number.isFinite(seconds) ? seconds : 3600) * 1000,
  };
}

/** Recruiting systems, whose mail is about applications. */
const RECRUITING_SENDERS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'workday.com',
  'smartrecruiters.com',
  'icims.com',
  'taleo.net',
  'successfactors.com',
  'jobvite.com',
  'workable.com',
  'bamboohr.com',
  'teamtailor.com',
  'recruitee.com',
  'pageuppeople.com',
  'jobadder.com',
];
// Job boards (LinkedIn, SEEK, Indeed) aren't listed above: they send alerts and
// news all day, and their application emails have a job word in the subject.
const SUBJECT_WORDS = [
  'application',
  'applied',
  'applying',
  'interview',
  'assessment',
  'offer',
  'position',
  'role',
  'candidate',
  'candidacy',
  'recruiter',
  'recruiting',
  'hiring',
  'opportunity',
  'unfortunately',
  '"next steps"',
  '"thank you for your interest"',
];

/**
 * Gmail's own search does the first cut, so only likely job mail is listed:
 * the inbox since `since`, minus promotions and social, from a recruiting
 * system, an employer on the board, or with a job word in the subject.
 */
export function gmailQuery(since: Date, companies: readonly string[]): string {
  const quote = (s: string) => `"${s.replace(/["\\]/g, ' ').trim()}"`;
  const employers = companies
    .map((c) => c.trim())
    .filter((c) => c.length >= 3)
    .slice(0, 30)
    .map(quote);
  const from = [...RECRUITING_SENDERS, ...employers].join(' OR ');
  return [
    'in:inbox',
    `after:${String(Math.floor(since.getTime() / 1000))}`,
    '-category:promotions',
    '-category:social',
    `{from:(${from}) subject:(${SUBJECT_WORDS.join(' OR ')})}`,
  ].join(' ');
}

export class GmailClient implements MailClient {
  constructor(private readonly fetcher: typeof fetch) {}

  async address(token: string): Promise<string> {
    const profile = await getJson<{ emailAddress?: string }>(this.fetcher, `${API}/profile`, token);
    if (!profile.emailAddress) throw new MailAuthError('No Gmail address');
    return profile.emailAddress;
  }

  async list(token: string, since: Date, limit: number, companies: readonly string[]) {
    const q = gmailQuery(since, companies);
    // Gmail lists newest first: the newest `limit` since the last check, so
    // new mail never waits behind a backlog (a busy inbox's first two weeks).
    const params = new URLSearchParams({ q, maxResults: String(limit) });
    const page = await getJson<{ messages?: { id: string }[] }>(
      this.fetcher,
      `${API}/messages?${params.toString()}`,
      token,
    );
    const ids = (page.messages ?? []).map((m) => m.id).slice(0, limit);
    const out = [];
    for (const id of ids) {
      const meta = await getJson<GmailMessage>(
        this.fetcher,
        `${API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        token,
      );
      out.push({
        id,
        receivedAt: new Date(Number(meta.internalDate ?? Date.now())).toISOString(),
        look: gmailFirstLook(meta),
      });
    }
    return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  async read(token: string, id: string): Promise<EmailInput | undefined> {
    const message = await getJson<GmailMessage>(
      this.fetcher,
      `${API}/messages/${encodeURIComponent(id)}?format=full`,
      token,
    );
    return gmailToInput(message);
  }
}
