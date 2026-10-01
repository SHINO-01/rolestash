import type { BackendConfig } from '@/services/backend/supabase-client';

/** Public backend settings baked in at build time (.env.staging; ADR-0017). */
const env = import.meta.env as Record<string, string | undefined>;

export const webConfig: BackendConfig = {
  url: env.WXT_SUPABASE_URL ?? '',
  anonKey: env.WXT_SUPABASE_ANON_KEY ?? '',
  ...(env.WXT_GOOGLE_CLIENT_ID ? { googleClientId: env.WXT_GOOGLE_CLIENT_ID } : {}),
};
