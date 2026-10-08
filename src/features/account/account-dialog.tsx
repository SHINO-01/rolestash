import { formatDate } from '@/ui/format';
import { ArrowLeft, ExternalLink, LogOut, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  ACTIVE_JOB_LIMITS,
  BILLING_INTERVALS,
  TRIAL_DAYS,
  type BillingInterval,
  countActiveJobs,
  PAID_PLANS,
  type PaidPlan,
} from '@/domain/plan';
import type { AccountService, AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { Chip } from '@/ui/components/chip';
import { Field, Input } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useServices } from '@/ui/hooks/services';
import { useJobs, useSettings } from '@/ui/hooks/services';
import {
  backendErrorMessage,
  formatMinor,
  PLAN_PITCH,
  planPriceLabel,
  planChip,
  planSummary,
} from './plan-copy';
import { EmailSection } from '@/features/email/email-section';
import { NameQuestion } from './name-question';
import { ProfileSection } from './profile-section';
import { SharingChoice } from './sharing-choice';
import type { LocalPrices, PlanChangePreview } from '@/services/backend/supabase-client';
import { ReferralSection } from './referral-section';
import { SyncSection } from './sync-section';
import { PasswordSignIn } from './password-sign-in';
import { SecuritySection } from './security-section';
import { SecondStep } from './second-step';

const SITE = 'https://rolestash.com';

export function AccountDialog({
  open,
  onClose,
  account,
  state,
}: {
  open: boolean;
  onClose: () => void;
  account: AccountService;
  state: AccountState | undefined;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        state?.signedIn
          ? 'Your account'
          : state?.needsSecondStep
            ? 'Two-step sign-in'
            : `Start your ${String(TRIAL_DAYS)}-day free trial`
      }
      description={
        state?.signedIn
          ? state.email
          : state?.needsSecondStep
            ? 'One more step to sign in.'
            : `${String(TRIAL_DAYS)} days of Pro: unlimited jobs, email updates, autofill, insights, sync and more. No card needed.`
      }
    >
      {state?.signedIn ? (
        <SignedIn account={account} state={state} />
      ) : state?.needsSecondStep ? (
        <SecondStep account={account} />
      ) : (
        <SignIn account={account} />
      )}
    </Dialog>
  );
}

function SignIn({ account }: { account: AccountService }) {
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'google' | 'email' | 'code' | null>(null);
  const [error, setError] = useState<string>();
  const [google, setGoogle] = useState(false);
  // "Help improve automatic updates": on by default, chosen here (ADR-0019, ADR-0022).
  const [share, setShare] = useState(true);

  // Offer Google only when the project has it switched on.
  useEffect(() => {
    let active = true;
    void account.googleSignInAvailable().then((on) => {
      if (active) setGoogle(on);
    });
    return () => {
      active = false;
    };
  }, [account]);

  async function run(kind: 'google' | 'email' | 'code', task: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    try {
      if (kind !== 'email') await account.chooseSharingAtSignIn(share);
      await task();
    } catch (e) {
      setError(backendErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const sendCode = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    void run('email', async () => {
      await account.requestEmailCode(email);
      setStep('code');
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {google ? (
        <>
          <Button
            className="w-full justify-center"
            loading={busy === 'google'}
            disabled={busy !== null}
            onClick={() => void run('google', () => account.signInWithGoogle())}
            icon={<GoogleMark />}
          >
            Continue with Google
          </Button>

          <div className="text-subtle flex items-center gap-3 text-xs">
            <span className="bg-line h-px flex-1" /> or use email{' '}
            <span className="bg-line h-px flex-1" />
          </div>
        </>
      ) : null}

      {step === 'password' ? (
        <PasswordSignIn
          account={account}
          before={() => account.chooseSharingAtSignIn(share)}
          onUseCode={() => setStep('email')}
        />
      ) : step === 'email' ? (
        <form className="flex flex-col gap-3" onSubmit={sendCode}>
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={busy === 'email'}
            disabled={busy !== null || !email.includes('@')}
            icon={<Mail className="size-4" />}
          >
            Email me a sign-in code
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            disabled={busy !== null}
            onClick={() => setStep('password')}
          >
            Use a password instead
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run('code', () => account.verifyEmailCode(email, code));
          }}
        >
          <p className="text-muted text-sm">
            We sent a 6-digit code to <strong className="text-ink">{email}</strong>. It expires in
            10 minutes.
          </p>
          <Field label="Sign-in code">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                aria-label="Sign-in code"
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={busy === 'code'}
            disabled={busy !== null || code.replace(/\s/g, '').length < 6}
          >
            Sign in
          </Button>
          <div className="flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => {
                setStep('email');
                setCode('');
              }}
            >
              Different email
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => sendCode()}>
              Send a new code
            </Button>
          </div>
        </form>
      )}

      <SharingChoice checked={share} disabled={busy !== null} onChange={setShare} />

      {error ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <p className="text-subtle text-xs">
        By continuing you agree to the{' '}
        <a className="underline" href={`${SITE}/terms/`} target="_blank" rel="noreferrer">
          Terms
        </a>{' '}
        and{' '}
        <a className="underline" href={`${SITE}/privacy/`} target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        . Your jobs stay on this device.
      </p>
    </div>
  );
}

function SignedIn({ account, state }: { account: AccountService; state: AccountState }) {
  const toast = useToast();
  const services = useServices();
  const { jobs } = useJobs();
  const { stages } = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  // Prices in this user's currency (Paddle, by location); US prices until they arrive.
  const [local, setLocal] = useState<LocalPrices>();
  useEffect(() => {
    let live = true;
    void account.localPrices().then((prices) => {
      if (live) setLocal(prices);
    });
    return () => {
      live = false;
    };
  }, [account]);
  const [pending, setPending] = useState<{
    tier: PaidPlan;
    interval: BillingInterval;
    preview: PlanChangePreview;
  }>();

  // Coming back from the checkout tab: re-read the plan straight away.
  useEffect(() => {
    if (!awaitingPayment) return;
    const onFocus = () => void account.refreshEntitlement();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [account, awaitingPayment]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
    } catch (e) {
      toast({ message: backendErrorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const openTab = async (url: Promise<string>) => {
    await browser.tabs.create({ url: await url });
  };

  const { plan } = state;
  const chip = planChip(plan);
  const active = countActiveJobs(jobs, stages);
  // A live subscription is switched in place; everyone else goes to checkout.
  const subscribed = plan.reason === 'subscribed' && plan.plan !== 'free';
  const limit = ACTIVE_JOB_LIMITS[plan.plan];

  const checkout = (tier: PaidPlan, interval: BillingInterval) =>
    void run(`${tier}-${interval}`, async () => {
      await openTab(account.checkoutUrl(tier, interval));
      setAwaitingPayment(true);
    });
  // A live subscription changes only after the user has seen what it costs now.
  const switchTo = (tier: PaidPlan, interval: BillingInterval) =>
    void run(`${tier}-${interval}`, async () => {
      setPending({ tier, interval, preview: await account.previewPlanChange(tier, interval) });
    });
  const confirmSwitch = () =>
    void run('confirm', async () => {
      if (!pending) return;
      await account.changePlan(pending.tier, pending.interval);
      const { action, amount, currency } = pending.preview;
      setPending(undefined);
      toast({
        message:
          action === 'charge'
            ? `Billing changed. You were charged ${formatMinor(amount, currency)}; your receipt is on its way by email.`
            : 'Billing changed.',
        tone: 'success',
      });
    });

  return (
    <div className="flex flex-col gap-4">
      <section className="border-line rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Plan</span>
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </div>
        <p className="text-muted mt-2 text-sm">{planSummary(plan)}</p>
        {/* Only a limited plan needs counting. */}
        {Number.isFinite(limit) ? (
          <p className="text-muted mt-1 text-sm">
            {String(active)} of {String(limit)} active jobs used. Rejected jobs don't count.
          </p>
        ) : null}
      </section>

      {/* One place to give a name: the question first, then the profile once it's answered. */}
      {state.needsName ? (
        <NameQuestion account={account} />
      ) : (
        <ProfileSection account={account} state={state} />
      )}
      <SyncSection plan={plan.plan} />
      <EmailSection plan={plan.plan} trial={plan.reason === 'trial'} />
      <ReferralSection account={account} />
      <SecuritySection account={account} state={state} />

      {plan.complimentary ? null : (
        <section className="flex flex-col gap-3">
          <span className="text-sm font-semibold">
            {subscribed ? 'Change how often you pay' : 'Get Pro'}
          </span>
          {PAID_PLANS.map((tier) => (
            <div key={tier} className="border-line flex flex-col gap-2 rounded-xl border p-3">
              {subscribed ? null : <p className="text-muted text-sm">{PLAN_PITCH[tier]}</p>}
              {pending?.tier === tier ? (
                <ConfirmSwitch
                  pending={pending}
                  busy={busy === 'confirm'}
                  onConfirm={confirmSwitch}
                  onCancel={() => setPending(undefined)}
                />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {BILLING_INTERVALS.map((interval) => (
                    <Button
                      key={interval}
                      variant={interval === 'month' ? 'primary' : 'secondary'}
                      loading={busy === `${tier}-${interval}`}
                      disabled={busy !== null}
                      onClick={() =>
                        subscribed ? switchTo(tier, interval) : checkout(tier, interval)
                      }
                    >
                      {planPriceLabel(tier, interval, local)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-subtle text-xs">
            {subscribed
              ? 'You’ll see the cost before anything changes, and you’re charged (or credited) only the difference for the rest of this billing period. Payments are handled by Paddle, our reseller.'
              : 'Prices in your currency, with tax as your country requires. Secure checkout by Paddle, our reseller, in a new tab. 14-day money-back guarantee.'}
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {state.hasBillingAccount ? (
          <Button
            icon={<ExternalLink className="size-4" />}
            loading={busy === 'portal'}
            disabled={busy !== null}
            onClick={() => void run('portal', () => openTab(account.billingPortalUrl()))}
          >
            Manage subscription
          </Button>
        ) : null}
        <Button
          variant="ghost"
          icon={<RefreshCw className="size-4" />}
          loading={busy === 'refresh'}
          disabled={busy !== null}
          onClick={() =>
            void run('refresh', async () => {
              const ok = await account.refreshEntitlement();
              toast(
                ok
                  ? { message: 'Plan up to date', tone: 'success' }
                  : { message: "Can't reach Rolestash right now", tone: 'error' },
              );
            })
          }
        >
          Refresh plan
        </Button>
        <Button
          variant="ghost"
          icon={<LogOut className="size-4" />}
          disabled={busy !== null}
          onClick={() =>
            void run('signout', async () => {
              // Mail access is the person's, not the browser's: it ends with them.
              await services.mailbox?.disconnect().catch(() => undefined);
              await account.signOut();
            })
          }
        >
          Sign out
        </Button>
      </div>

      <section className="border-line border-t pt-4">
        {confirmDelete ? (
          <div className="flex flex-col gap-3 rounded-xl bg-rose-50 p-4 dark:bg-rose-500/10">
            <p className="text-sm">
              <strong>Delete your Rolestash account?</strong> Any subscription is canceled
              immediately and your account data is deleted from our servers. Jobs on this device are
              kept. This can't be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                loading={busy === 'delete'}
                disabled={busy !== null}
                onClick={() =>
                  void run('delete', async () => {
                    await account.deleteAccount();
                    toast({ message: 'Account deleted', tone: 'success' });
                  })
                }
              >
                Delete account
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep account
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete account…
          </Button>
        )}
      </section>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
      />
    </svg>
  );
}

/** The amount due now for a plan switch, and the buttons to go ahead or not. */
function ConfirmSwitch({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: { tier: PaidPlan; interval: BillingInterval; preview: PlanChangePreview };
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { action, amount, currency, recurring, nextBilledAt } = pending.preview;
  const money = formatMinor(amount, currency);
  // The regular price in the same currency as today's charge, when Paddle gave it.
  const per = { month: 'a month', quarter: 'every 3 months', year: 'a year' }[pending.interval];
  const from = nextBilledAt ? ` from ${formatDate(nextBilledAt)}` : '';
  const then =
    recurring === undefined
      ? planPriceLabel(pending.tier, pending.interval, undefined)
      : `${formatMinor(recurring, currency)} ${per}${from}`;
  return (
    <div
      role="group"
      aria-label="Confirm plan change"
      className="bg-surface-2 rounded-lg p-3 text-sm"
    >
      <p>
        {action === 'charge'
          ? `You’ll be charged ${money} now, for the rest of this billing period. Then ${then}.`
          : action === 'credit'
            ? `You’ll get a ${money} credit toward your next bills. Then ${then}.`
            : `Nothing to pay now. Then ${then}.`}
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" loading={busy} disabled={busy} onClick={onConfirm}>
          {action === 'charge' ? `Pay ${money} and switch` : 'Switch plan'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
