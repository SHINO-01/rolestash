import { handle } from './app';
import { runReferralJob } from './jobs';
import type { Env } from './panels';

/** The bits of Cloudflare's scheduled-event context this Worker uses. */
interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** Cloudflare Worker entry for operations.rolestash.com (ADR-0026, ADR-0037). */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { fetch: (input, init) => fetch(input, init), now: new Date() });
  },
  /** The daily referral job (wrangler.jsonc triggers): qualify, reward, apply Paddle months. */
  scheduled(_event: unknown, env: Env, ctx: WaitUntil): void {
    if (!env.OPS_ADMIN_SECRET) return;
    ctx.waitUntil(
      runReferralJob(
        env,
        { fetch: (input, init) => fetch(input, init), now: new Date() },
        'daily job',
      ).then(
        (s) => console.log('ops: referral job', JSON.stringify(s)),
        (e: unknown) =>
          console.error('ops: referral job failed', e instanceof Error ? e.message : e),
      ),
    );
  },
};
