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
  // Email (Resend) is optional: only the welcome and bug-report functions use it.
  const resendApiKey = get('RESEND_API_KEY');
  return {
    ...(resendApiKey
      ? {
          email: {
            resendApiKey,
            from: get('ACCOUNT_FROM') ?? 'Rolestash <noreply@rolestash.com>',
            support: get('SUPPORT_EMAIL') ?? 'support@rolestash.com',
          },
        }
      : {}),
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
        pro: {
          month: need('PADDLE_PRICE_PRO_MONTHLY'),
          quarter: need('PADDLE_PRICE_PRO_QUARTERLY'),
          year: need('PADDLE_PRICE_PRO_YEARLY'),
        },
        advanced: {
          month: need('PADDLE_PRICE_ADVANCED_MONTHLY'),
          quarter: need('PADDLE_PRICE_ADVANCED_QUARTERLY'),
          year: need('PADDLE_PRICE_ADVANCED_YEARLY'),
        },
      },
    },
  };
}
