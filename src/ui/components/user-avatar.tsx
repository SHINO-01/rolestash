import clsx from 'clsx';
import { avatarHue, initials, isSafeAvatar, type AccountProfile } from '@/domain/account-profile';

const PALETTE = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
];

/**
 * The account's picture, or its initials on a stable colour (ADR-0022). The
 * picture is an inline data: URL checked again here, so nothing is ever
 * fetched from another server.
 */
export function UserAvatar({
  profile,
  name,
  email,
  size = 'md',
  className,
}: {
  profile: AccountProfile;
  /** First name for the initials (see firstNameFrom). */
  name?: string | undefined;
  email?: string | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims = { sm: 'size-6 text-[10px]', md: 'size-9 text-xs', lg: 'size-16 text-lg' }[size];
  if (isSafeAvatar(profile.avatar))
    return (
      <img
        src={profile.avatar}
        alt=""
        width={128}
        height={128}
        className={clsx('shrink-0 rounded-full object-cover', dims, className)}
      />
    );
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        dims,
        PALETTE[avatarHue(email ?? name ?? '') % PALETTE.length],
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}
