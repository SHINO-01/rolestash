import { Camera, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DISPLAY_NAME_MAX, type AccountProfile } from '@/domain/account-profile';
import type { AccountService, AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';
import { useToast } from '@/ui/components/toast';
import { UserAvatar } from '@/ui/components/user-avatar';
import { AvatarError, resizeAvatar } from '@/ui/resize-avatar';
import { backendErrorMessage } from './plan-copy';

/**
 * Display name and picture (ADR-0022). The picture is shrunk to 128 pixels
 * on this device before it's saved; without one, initials are shown.
 */
export function ProfileSection({
  account,
  state,
}: {
  account: AccountService;
  state: AccountState;
}) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(state.profile.displayName ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void account.refreshProfile().catch(() => undefined);
  }, [account]);

  async function save(next: AccountProfile, message: string) {
    setBusy(true);
    try {
      await account.saveProfile(next);
      toast({ message, tone: 'success' });
    } catch (e) {
      toast({
        message: e instanceof AvatarError ? e.message : backendErrorMessage(e),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  const trimmed = name.trim();
  const current = state.profile;
  const withName = (p: AccountProfile): AccountProfile => ({
    ...(p.avatar ? { avatar: p.avatar } : {}),
    ...(trimmed ? { displayName: trimmed } : {}),
  });

  return (
    <section className="border-line rounded-xl border p-4" aria-label="Profile">
      <span className="text-sm font-semibold">Profile</span>
      <div className="mt-3 flex items-center gap-4">
        <UserAvatar profile={current} email={state.email} size="lg" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Camera className="size-4" />}
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            {current.avatar ? 'Change photo' : 'Add photo'}
          </Button>
          {current.avatar ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              disabled={busy}
              onClick={() =>
                void save(
                  current.displayName ? { displayName: current.displayName } : {},
                  'Photo removed',
                )
              }
            >
              Remove
            </Button>
          ) : null}
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            aria-label="Choose a profile photo"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (!picked) return;
              void (async () => {
                try {
                  const avatar = await resizeAvatar(picked);
                  await save(
                    {
                      ...(current.displayName ? { displayName: current.displayName } : {}),
                      avatar,
                    },
                    'Photo saved',
                  );
                } catch (err) {
                  toast({
                    message:
                      err instanceof AvatarError ? err.message : 'Couldn’t read that picture.',
                    tone: 'error',
                  });
                }
              })();
            }}
          />
        </div>
      </div>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(withName(current), trimmed ? 'Name saved' : 'Name removed');
        }}
      >
        <Field label="Display name" className="flex-1">
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="name"
              placeholder="How Rolestash greets you"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          disabled={busy || trimmed === (current.displayName ?? '')}
          loading={busy}
        >
          Save
        </Button>
      </form>
      <p className="text-subtle mt-2 text-xs">
        Your photo is shrunk to a small square on this device and kept with your account. It’s never
        loaded from Google or anywhere else.
      </p>
    </section>
  );
}
