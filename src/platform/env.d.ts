/** Build-time backend settings (public values; see docs/guides/backend.md). */
interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL?: string;
  readonly WXT_SUPABASE_ANON_KEY?: string;
  /** Google OAuth web client ID (public); enables "Continue with Google". */
  readonly WXT_GOOGLE_CLIENT_ID?: string;
}
