import type { FunctionEnv } from './handlers.ts';

/**
 * Reads Edge Function secrets. SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are injected by Supabase; the PADDLE_* values are
 * set with `supabase secrets set` (docs/guides/backend.md).
 */
export function readEnv(get: (name: string) => string | undefined): FunctionEnv {
  const need = (name: string): string => {
    const value = get(name);
    if (!value) throw new Error(`Missing secret ${name}`);
    return value;
  };
  const environment = get('PADDLE_ENV') === 'production' ? 'production' : 'sandbox';
  return {
    supabase: {
      url: need('SUPABASE_URL'),
      anonKey: need('SUPABASE_ANON_KEY'),
      serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    },
    paddle: {
      environment,
      apiKey: need('PADDLE_API_KEY'),
      webhookSecret: need('PADDLE_WEBHOOK_SECRET'),
      prices: { month: need('PADDLE_PRICE_MONTHLY'), year: need('PADDLE_PRICE_YEARLY') },
    },
  };
}
