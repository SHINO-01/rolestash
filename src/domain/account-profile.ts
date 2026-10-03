import { z } from 'zod';

/**
 * The account's full name and picture (ADR-0022, ADR-0024): the name on the
 * person's Google account, or the one they typed once; used in Account, for
 * greetings and on Paddle receipts. The picture is a small
 * image resized on the device and kept inline as a data: URL, so it is never
 * loaded from anyone else's server. Mirrors public.account_profiles.
 */

export const AVATAR_SIZE = 128;
/** Matches the database check (60,000 bytes). */
export const AVATAR_MAX_LENGTH = 60_000;
/** Matches the database check (ADR-0024: legal names can be long). */
export const DISPLAY_NAME_MAX = 100;

const AVATAR_PATTERN = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Only inline raster images: never a link (tracking) or SVG (script). */
export function isSafeAvatar(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= AVATAR_MAX_LENGTH && AVATAR_PATTERN.test(value)
  );
}

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'No control characters');

export const AccountProfileSchema = z.object({
  displayName: DisplayNameSchema.optional(),
  avatar: z.string().refine(isSafeAvatar).optional(),
});
export type AccountProfile = z.infer<typeof AccountProfileSchema>;

/** Up to two initials, from the display name or else the email's local part. */
export function initials(displayName: string | undefined, email: string | undefined): string {
  const fromEmail = email?.split('@')[0]?.replace(/[._-]+/g, ' ') ?? '';
  const source = displayName?.trim().length ? displayName.trim() : fromEmail;
  const words = source.split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => Array.from(w ?? '').slice(0, 1);
  const letters =
    words.length >= 2
      ? [...first(words[0]), ...first(words[words.length - 1])]
      : Array.from(words[0] ?? '').slice(0, 2);
  return letters.join('').toUpperCase() || '?';
}

/**
 * The first name to greet someone by: the first word of the name their
 * provider gave (Google), or else a best guess from the email address
 * ("sam.taylor" → "Sam", "sakifhussain33" → "Sakifhussain"). Undefined when
 * nothing sensible is left (a number-only address, say).
 */
export function firstNameFrom(
  name: string | undefined,
  email: string | undefined,
): string | undefined {
  const fromName = name?.trim().split(/\s+/)[0];
  const local = email?.split('@')[0] ?? '';
  const guess = local
    .split(/[._+-]+/)
    .map((part) => part.replace(/\d+/g, ''))
    .find((part) => part.length >= 2);
  // A provider's name is kept as written ("McKenzie"); a guess is capitalised.
  if (fromName && /\p{L}/u.test(fromName)) return fromName;
  if (!guess) return undefined;
  return guess.charAt(0).toLocaleUpperCase() + guess.slice(1).toLocaleLowerCase();
}

/** A stable hue for the initials circle, from the email (0–359). */
export function avatarHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}
