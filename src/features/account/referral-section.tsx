import { Copy, RefreshCw, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AccountService } from '@/services/account-service';
import type { Referral } from '@/services/backend/supabase-client';
import { Button } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';
import { backendErrorMessage, referralCounts } from './plan-copy';

const SITE = 'https://rolestash.com';

/**
 * "Give a friend money off, get a month" (ADR-0035): the account's referral
 * link with Copy and Share, and how many friends joined. Hidden while the
 * programme is off (the owner turns it on from the operations dashboard).
 */
export function ReferralSection({ account }: { account: AccountService }) {
  const toast = useToast();
  const [referral, setReferral] = useState<Referral>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    account
      .referral()
      .then((r) => {
        if (active) setReferral(r);
      })
      .catch(() => undefined); // offline or signed out: the section just doesn't show
    return () => {
      active = false;
    };
  }, [account]);

  if (!referral?.enabled || !referral.code) return null;
  const link = `${SITE}/r/${referral.code}`;
  const percent = referral.percent ?? 50;
  const canShare = typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast({ message: 'Link copied', tone: 'success', durationMs: 2000 });
    } catch {
      toast({ message: 'Couldn’t copy. Select the link and copy it instead.', tone: 'error' });
    }
  }

  async function newLink() {
    setConfirming(false);
    setBusy(true);
    try {
      const code = await account.rotateReferral();
      setReferral((r) => (r ? { ...r, code } : r));
    } catch (e) {
      toast({ message: backendErrorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-line flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <span className="text-sm font-semibold">Invite friends</span>
        <p className="text-muted mt-1 text-sm">
          Friends get {String(percent)}% off their first month of Pro (monthly). You get a free
          month for each friend who stays past their first 14 days, up to 12 a year.
        </p>
      </div>
      <input
        readOnly
        value={link}
        aria-label="Your referral link"
        onFocus={(e) => e.currentTarget.select()}
        className="border-line bg-surface-2 h-9 w-full rounded-lg border px-3 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy className="size-4" />}
          onClick={() => void copy()}
        >
          Copy link
        </Button>
        {canShare ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Share2 className="size-4" />}
            onClick={() =>
              void navigator
                .share({
                  title: 'Rolestash',
                  text: 'Track your job applications with Rolestash.',
                  url: link,
                })
                .catch(() => undefined)
            }
          >
            Share
          </Button>
        ) : null}
        {confirming ? null : (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-4" />}
            loading={busy}
            onClick={() => setConfirming(true)}
          >
            New link
          </Button>
        )}
      </div>
      {confirming ? (
        <div className="bg-surface-2 flex flex-wrap items-center gap-2 rounded-lg p-3 text-sm">
          <span className="text-muted flex-1">
            Make a new link? Your current link stops working.
          </span>
          <Button size="sm" variant="secondary" onClick={() => void newLink()}>
            Make a new link
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      <p className="text-muted text-sm">{referralCounts(referral)}</p>
    </section>
  );
}
