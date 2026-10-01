import { CalendarCheck, Columns3, Inbox, Plus, UserRound, WifiOff } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AccountService } from '@/services/account-service';
import { backendErrorMessage } from '@/features/account/plan-copy';
import { SyncSection } from '@/features/account/sync-section';
import { Button, Spinner } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';
import { Logo } from '@/ui/components/misc';
import { useAccount } from '@/ui/hooks/account';
import { useServices } from '@/ui/hooks/services';
import { useAutoSync, useSyncState } from '@/ui/hooks/sync';
import { useAutoEmailUpdates, useEmailState } from '@/ui/hooks/email';
import { UnsortedDialog } from '@/features/email/unsorted-dialog';
import { relativeTime } from '@/ui/format';
import { AccountView } from './account-view';
import { BoardView } from './board-view';
import { JobSheet } from './job-sheet';
import { QuickAdd } from './quick-add';
import { TodayView } from './today-view';
import { webConfig } from './config';
import {
  allowExtensionSignIn,
  completeGoogleSignIn,
  signInFromExtension,
  startGoogleSignIn,
} from './sign-in';

type Tab = 'today' | 'board' | 'account';

/**
 * The web board (Advanced; ADR-0017): sign in, check the plan, join sync as
 * this browser's `web` device, then a phone-first app: Today, Board, Account.
 */
export function WebBoard() {
  const { account } = useServices();
  const { state } = useAccount();
  if (!account) return <Centered>The web board isn’t available right now.</Centered>;
  if (!state)
    return (
      <Centered>
        <Spinner /> Loading…
      </Centered>
    );
  if (!state.signedIn) return <WebSignIn account={account} />;
  if (state.plan.plan !== 'advanced') return <AdvancedOnly account={account} />;
  return (
    <JoinSync>
      <WebApp />
    </JoinSync>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="bg-canvas text-muted flex min-h-dvh items-center justify-center gap-2 p-6 text-sm">
      {children}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-canvas min-h-dvh px-5 py-8">
      <div className="mx-auto flex max-w-sm flex-col gap-5">
        <Logo />
        {children}
      </div>
    </main>
  );
}

function WebSignIn({ account }: { account: AccountService }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // First: finish a Google return, or sign in from the extension in this browser.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const live = { active: true };
    void (async () => {
      try {
        if (await completeGoogleSignIn(account)) return;
        await signInFromExtension(account);
      } catch (e) {
        if (live.active)
          setError(e instanceof Error && !('code' in e) ? e.message : backendErrorMessage(e));
      } finally {
        if (live.active) setChecking(false);
      }
    })();
    return () => {
      live.active = false;
    };
  }, [account]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError(backendErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (checking)
    return (
      <Centered>
        <Spinner /> Signing you in…
      </Centered>
    );

  return (
    <Shell>
      <div>
        <h1 className="text-xl font-semibold">Your board, on your phone</h1>
        <p className="text-muted mt-1 text-sm">
          Sign in with the account you use in the Rolestash extension. The web board is part of
          Advanced.
        </p>
      </div>
      {webConfig.googleClientId ? (
        <>
          <Button
            variant="secondary"
            className="h-11"
            loading={busy}
            onClick={() => void run(() => startGoogleSignIn(webConfig.googleClientId ?? ''))}
          >
            Continue with Google
          </Button>
          <p className="text-subtle text-center text-xs">or get a code by email</p>
        </>
      ) : null}
      {!sent ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await account.requestEmailCode(email);
              setSent(true);
            });
          }}
        >
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Email me a sign-in code
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await account.verifyEmailCode(email, code.trim());
              allowExtensionSignIn();
            });
          }}
        >
          <Field label={`Code sent to ${email}`}>
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Sign in
          </Button>
          <button
            type="button"
            className="text-accent text-sm font-medium"
            onClick={() => setSent(false)}
          >
            Use a different email
          </button>
        </form>
      )}
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      <p className="text-subtle text-xs">
        Signed in to the Rolestash extension on this computer? This page signs you in by itself.
      </p>
    </Shell>
  );
}

function AdvancedOnly({ account }: { account: AccountService }) {
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <div>
        <h1 className="text-xl font-semibold">The web board is part of Advanced</h1>
        <p className="text-muted mt-2 text-sm">
          Advanced puts your whole board on your phone: today’s follow-ups and closing dates, every
          column, notes, and quick updates that sync back to your computer. It also syncs up to 5
          devices and updates your board from job emails.
        </p>
      </div>
      <Button
        variant="primary"
        loading={busy}
        onClick={() => {
          setBusy(true);
          void account
            .checkoutUrl('advanced', 'month')
            .then((url) => location.assign(url))
            .finally(() => setBusy(false));
        }}
      >
        Get Advanced: US$15 / month
      </Button>
      <Button variant="ghost" onClick={() => void account.signOut()}>
        Sign out
      </Button>
    </Shell>
  );
}

/** Registers this browser as a sync device on first use; explains the limit if full. */
function JoinSync({ children }: { children: ReactNode }) {
  const { sync } = useServices();
  const state = useSyncState();
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!sync || !state || state.enabled || full) return;
    sync
      .enable()
      .then(async (result) => {
        if (result.ok) await sync.sync();
        else setFull(true);
      })
      .catch((e: unknown) => setError(backendErrorMessage(e)));
  }, [sync, state, full]);

  if (state?.enabled) return children;
  if (full)
    return (
      <Shell>
        <p className="text-sm">
          You’re already syncing 5 devices. Remove one to use the web board on this browser.
        </p>
        <SyncSection plan="advanced" />
      </Shell>
    );
  return (
    <Centered>
      {error ?? (
        <>
          <Spinner /> Getting your board…
        </>
      )}
    </Centered>
  );
}

const online = {
  subscribe: (cb: () => void) => {
    window.addEventListener('online', cb);
    window.addEventListener('offline', cb);
    return () => {
      window.removeEventListener('online', cb);
      window.removeEventListener('offline', cb);
    };
  },
  get: () => navigator.onLine,
};

function WebApp() {
  useAutoSync();
  // Only Advanced reaches the web board, and email updates are Advanced.
  useAutoEmailUpdates('advanced');
  const unsorted = useEmailState()?.unsorted.length ?? 0;
  const [sorting, setSorting] = useState(false);
  const sync = useSyncState();
  const isOnline = useSyncExternalStore(online.subscribe, online.get);
  const [tab, setTab] = useState<Tab>('today');
  const [openId, setOpenId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>();

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'today', label: 'Today', icon: <CalendarCheck className="size-5" /> },
    { id: 'board', label: 'Board', icon: <Columns3 className="size-5" /> },
    { id: 'account', label: 'Account', icon: <UserRound className="size-5" /> },
  ];

  return (
    <div className="bg-canvas flex min-h-dvh flex-col">
      <header className="bg-canvas/90 border-line sticky top-0 z-10 flex h-14 items-center justify-between border-b px-4 backdrop-blur">
        <Logo />
        {unsorted > 0 ? (
          <button
            type="button"
            onClick={() => setSorting(true)}
            className="text-accent flex items-center gap-1 text-xs font-medium"
          >
            <Inbox className="size-4" /> Unsorted ({unsorted})
          </button>
        ) : null}
        <span className="text-subtle flex items-center gap-1.5 text-xs">
          {!isOnline ? (
            <>
              <WifiOff className="size-3.5" /> Offline: changes sync later
            </>
          ) : sync?.lastSyncAt ? (
            `Synced ${relativeTime(sync.lastSyncAt)}`
          ) : null}
        </span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-28">
        {tab === 'today' ? (
          <TodayView
            onOpen={setOpenId}
            onShowStage={(id) => {
              setStageFilter(id);
              setTab('board');
            }}
          />
        ) : tab === 'board' ? (
          <BoardView onOpen={setOpenId} stage={stageFilter} onStage={setStageFilter} />
        ) : (
          <AccountView />
        )}
      </main>

      <button
        type="button"
        aria-label="Add a job"
        onClick={() => setAdding(true)}
        className="bg-accent shadow-lift fixed right-5 bottom-20 z-10 grid size-14 place-items-center rounded-full text-white dark:text-zinc-950"
      >
        <Plus className="size-6" />
      </button>

      <nav
        aria-label="Sections"
        className="bg-surface border-line fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t pb-[env(safe-area-inset-bottom)]"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              tab === t.id ? 'text-accent' : 'text-muted'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <JobSheet id={openId} onClose={() => setOpenId(undefined)} />
      <UnsortedDialog open={sorting} onClose={() => setSorting(false)} />
      <QuickAdd open={adding} onClose={() => setAdding(false)} onAdded={setOpenId} />
    </div>
  );
}
