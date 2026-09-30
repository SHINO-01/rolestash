import { Sparkles } from 'lucide-react';
import { countActiveJobs, FREE_ACTIVE_JOB_LIMIT } from '@/domain/plan';
import type { AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { useJobs, useSettings } from '@/ui/hooks/services';

/** Warn this many jobs before the free limit. */
export const LIMIT_WARNING_AT = FREE_ACTIVE_JOB_LIMIT - 5;
const TRIAL_WARNING_DAYS = 5;

/** A one-line nudge under the header, only when there's something to act on. */
export function PlanBanner({
  state,
  onOpenAccount,
}: {
  state: AccountState;
  onOpenAccount: () => void;
}) {
  const { jobs } = useJobs();
  const { stages } = useSettings();
  const active = countActiveJobs(jobs, stages);
  const { plan } = state;

  let message: string | undefined;
  let action = 'See Pro';
  if (plan.reason === 'stale') {
    message = "We couldn't confirm your Pro plan for over a week, so you're on Free for now.";
    action = 'Check plan';
  } else if (plan.reason === 'trial' && (plan.trialDaysLeft ?? 0) <= TRIAL_WARNING_DAYS) {
    message = `Your Pro trial ends in ${String(plan.trialDaysLeft ?? 0)} day${plan.trialDaysLeft === 1 ? '' : 's'}. Your jobs stay either way.`;
    action = 'Keep Pro';
  } else if (plan.plan === 'free' && active >= FREE_ACTIVE_JOB_LIMIT) {
    message = `You've reached the free plan's ${String(FREE_ACTIVE_JOB_LIMIT)} active jobs. Move finished ones to Rejected or Withdrawn, or upgrade for unlimited jobs.`;
    action = state.signedIn ? 'Upgrade' : 'Try Pro free';
  } else if (plan.plan === 'free' && active >= LIMIT_WARNING_AT) {
    message = `${String(active)} of ${String(FREE_ACTIVE_JOB_LIMIT)} free active jobs used.`;
    action = state.signedIn ? 'Upgrade' : 'Try Pro free';
  }
  if (!message) return null;

  return (
    <div
      role="status"
      aria-label="Plan notice"
      className="bg-accent-soft text-accent-ink mx-6 mb-2 flex items-center gap-3 rounded-xl px-4 py-2 text-sm"
    >
      <Sparkles className="size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <Button size="sm" variant="primary" onClick={onOpenAccount}>
        {action}
      </Button>
    </div>
  );
}
