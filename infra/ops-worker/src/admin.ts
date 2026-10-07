import type { Deps, Env } from './panels';

/**
 * The dashboard's database actions (ADR-0037): one secret-gated, audited
 * function, public.ops_admin, called with the publishable key and the
 * Worker's OPS_ADMIN_SECRET. The actor is the Access-verified email.
 */

/** A refusal worth showing as is: the database's own message ("The end date must be in the future"). */
export class AdminError extends Error {
  override name = 'AdminError';
}

export const adminConfigured = (env: Env): boolean =>
  Boolean(env.OPS_ADMIN_SECRET && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);

export async function opsAdmin<T = unknown>(
  env: Env,
  deps: Deps,
  actor: string,
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!adminConfigured(env))
    throw new AdminError('Changes need OPS_ADMIN_SECRET (docs/guides/operations.md).');
  const response = await deps.fetch(`${env.SUPABASE_URL ?? ''}/rest/v1/rpc/ops_admin`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY ?? '',
      Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_secret: env.OPS_ADMIN_SECRET,
      p_actor: actor,
      p_action: action,
      p_args: args,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  if (body.code === 'P0001' && body.message) throw new AdminError(body.message.slice(0, 300));
  if (body.code === '42501')
    throw new AdminError('The database refused the dashboard: check OPS_ADMIN_SECRET.');
  throw new Error(`HTTP ${String(response.status)}`);
}
