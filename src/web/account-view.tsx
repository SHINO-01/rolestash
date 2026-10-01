import { LogOut } from 'lucide-react';
import { planChip, planSummary } from '@/features/account/plan-copy';
import { SyncSection } from '@/features/account/sync-section';
import { Button } from '@/ui/components/button';
import { Chip } from '@/ui/components/chip';
import { useAccount } from '@/ui/hooks/account';
import { useServices } from '@/ui/hooks/services';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import { SYNC_STATE_KEY } from '@/storage/keys';

/** Account on the web board: plan, synced devices, sign out (ADR-0017). */
export function AccountView() {
  const { account, state } = useAccount();
  const services = useServices();
  if (!account || !state) return null;

  // The web board's data is only a synced copy: signing out frees this
  // browser's device slot and clears the copy, so nothing stays behind.
  async function signOut() {
    await services.sync?.disable().catch(() => undefined);
    await services.jobs.deleteAll();
    await services.settings.replace(structuredClone(DEFAULT_SETTINGS));
    await services.store.remove([SYNC_STATE_KEY]);
    await account?.signOut();
  }

  const chip = planChip(state.plan);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Account</h1>
      <section className="border-line bg-surface rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">{state.email ?? 'Signed in'}</span>
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </div>
        <p className="text-muted mt-2 text-sm">{planSummary(state.plan)}</p>
        <p className="text-subtle mt-2 text-xs">
          Change your plan, export or delete your data from Account in the Rolestash extension.
        </p>
      </section>
      <SyncSection plan={state.plan.plan} />
      <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
        Sign out and clear this browser
      </Button>
      <p className="text-subtle -mt-2 text-center text-xs">
        Your board stays safe on your other devices.
      </p>
    </div>
  );
}
