/** Build-time backend settings (public values; see docs/guides/backend.md). */
interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL?: string;
  readonly WXT_SUPABASE_ANON_KEY?: string;
  /** Google OAuth web client ID (public); enables "Continue with Google". */
  readonly WXT_GOOGLE_CLIENT_ID?: string;
  /** Google web client for "Connect Gmail" (ADR-0032); set once Google verifies the Gmail scope. */
  readonly WXT_GMAIL_CLIENT_ID?: string;
  /** Microsoft Entra app (public client) ID; enables "Connect Outlook" (ADR-0032). */
  readonly WXT_MICROSOFT_CLIENT_ID?: string;
}
