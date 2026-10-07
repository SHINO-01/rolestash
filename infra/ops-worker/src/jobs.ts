import { opsAdmin } from './admin';
import { moveRenewal, paddleConfigured } from './paddle-admin';
import type { Deps, Env } from './panels';

/**
 * The daily referral job (ADR-0035, ADR-0037), from the Worker's cron
 * trigger or "Run referrals now": the database qualifies referrals past the
 * 14-day refund window and rewards Free referrers; then each paying
 * referrer's month is applied in Paddle (next renewal one month later, no
 * charge). If Paddle can't move it, the database gives a dated grant instead.
 */
export interface JobSummary {
  qualified: number;
  granted: number;
  paddleMoved: number;
  paddleFallback: number;
  failed: number;
}

export async function runReferralJob(env: Env, deps: Deps, actor: string): Promise<JobSummary> {
  const step = await opsAdmin<{ qualified?: number; granted?: number }>(
    env,
    deps,
    actor,
    'referrals.process',
  );
  const summary: JobSummary = {
    qualified: step.qualified ?? 0,
    granted: step.granted ?? 0,
    paddleMoved: 0,
    paddleFallback: 0,
    failed: 0,
  };
  if (!paddleConfigured(env)) return summary; // they wait, and show on the Referrals page
  const due = await opsAdmin<{ id: number; subscription_id: string | null }[]>(
    env,
    deps,
    actor,
    'referrals.paddle_due',
  );
  for (const reward of due) {
    try {
      const moved = reward.subscription_id
        ? await moveRenewal(env, deps, reward.subscription_id)
        : { ok: false, detail: 'no subscription' };
      await opsAdmin(env, deps, actor, 'referrals.paddle_done', {
        id: reward.id,
        ok: moved.ok,
        detail: moved.detail,
      });
      if (moved.ok) summary.paddleMoved++;
      else summary.paddleFallback++;
    } catch (error) {
      // Paddle down or the key lacks access: it stays due for the next run.
      summary.failed++;
      console.error(
        'ops: referral reward failed',
        reward.id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return summary;
}
