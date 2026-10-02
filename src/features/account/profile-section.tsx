import { Camera, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AccountProfile } from '@/domain/account-profile';
import type { AccountService, AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';
import { UserAvatar } from '@/ui/components/user-avatar';
import { AvatarError, resizeAvatar } from '@/ui/resize-avatar';
import { backendErrorMessage } from './plan-copy';

/**
 * Who's signed in (ADR-0022): the first name from Google or the email
 * address, and an optional photo, shrunk to 128 pixels on this device before
 * it's saved. Without a photo, initials are shown.
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

  const current = state.profile;
  return (
    <section className="border-line rounded-xl border p-4" aria-label="Profile">
      <div className="flex items-center gap-4">
        <UserAvatar profile={current} name={state.firstName} email={state.email} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{state.firstName ?? 'Signed in'}</p>
          <p className="text-muted truncate text-[13px]">{state.email}</p>
          <div className="mt-2 flex flex-wrap gap-2">
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
                onClick={() => void save({}, 'Photo removed')}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
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
                await save({ avatar: await resizeAvatar(picked) }, 'Photo saved');
              } catch (err) {
                toast({
                  message: err instanceof AvatarError ? err.message : 'Couldn’t read that picture.',
                  tone: 'error',
                });
              }
            })();
          }}
        />
      </div>
      <p className="text-subtle mt-3 text-xs">
        Your photo is shrunk to a small square on this device and kept with your account. It’s never
        loaded from Google or anywhere else.
      </p>
    </section>
  );
}
