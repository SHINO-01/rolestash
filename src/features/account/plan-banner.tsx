import { Sparkles } from 'lucide-react';
import { ACTIVE_JOB_LIMITS, activeJobsLabel, countActiveJobs, nextPlan } from '@/domain/plan';
import type { AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { useJobs, useSettings } from '@/ui/hooks/services';
import { PLAN_NAMES } from './plan-copy';

/** Warn this many jobs before a plan's limit. */
export const LIMIT_WARNING_MARGIN = 5;
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
  const limit = ACTIVE_JOB_LIMITS[plan.plan];

  let message: string | undefined;
  let action = 'Plans';
  if (plan.reason === 'stale') {
    message = "We couldn't confirm your plan for over a week, so you're on Free for now.";
    action = 'Check plan';
  } else if (plan.reason === 'trial' && (plan.trialDaysLeft ?? 0) <= TRIAL_WARNING_DAYS) {
    message = `Your ${PLAN_NAMES[plan.plan]} trial ends in ${String(plan.trialDaysLeft ?? 0)} day${plan.trialDaysLeft === 1 ? '' : 's'}. Your jobs stay either way.`;
    action = 'Choose a plan';
  } else if (active >= limit - LIMIT_WARNING_MARGIN) {
    const name = PLAN_NAMES[plan.plan];
    const next = nextPlan(plan.plan);
    message =
      active >= limit
        ? `You've reached the ${name} plan's ${String(limit)} active jobs. Archive finished ones or move them to Rejected or Withdrawn${next ? `, or upgrade to ${PLAN_NAMES[next]} for ${activeJobsLabel(next).toLowerCase()}` : ''}.`
        : `${String(active)} of ${String(limit)} active jobs used on ${name}.`;
    action = !next ? 'Plan' : state.signedIn ? `Get ${PLAN_NAMES[next]}` : 'Try it free';
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
