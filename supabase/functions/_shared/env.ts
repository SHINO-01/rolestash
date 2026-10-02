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
  // Never guess which Paddle account to use: a missing or mistyped value stops here.
  const paddleEnv = get('PADDLE_ENV');
  if (paddleEnv !== 'sandbox' && paddleEnv !== 'production')
    throw new Error('PADDLE_ENV must be "sandbox" or "production"');
  const environment: 'sandbox' | 'production' = paddleEnv;
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
      prices: {
        pro: { month: need('PADDLE_PRICE_PRO_MONTHLY'), year: need('PADDLE_PRICE_PRO_YEARLY') },
        advanced: {
          month: need('PADDLE_PRICE_ADVANCED_MONTHLY'),
          year: need('PADDLE_PRICE_ADVANCED_YEARLY'),
        },
      },
    },
  };
}
