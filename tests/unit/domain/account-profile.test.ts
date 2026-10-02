import { AccountProfileSchema, avatarHue, initials, isSafeAvatar } from '@/domain/account-profile';

describe('account profile', () => {
  it('makes initials from the name, or else the email', () => {
    expect(initials('Sam Taylor', 'x@example.com')).toBe('ST');
    expect(initials('Mary Jane van Dyke', undefined)).toBe('MD');
    expect(initials('  ', 'sam.taylor@example.com')).toBe('ST');
    expect(initials(undefined, 'sam@example.com')).toBe('SA');
    expect(initials(undefined, undefined)).toBe('?');
  });

  it('accepts only small inline raster pictures', () => {
    expect(isSafeAvatar('data:image/webp;base64,UklGRg==')).toBe(true);
    expect(isSafeAvatar('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isSafeAvatar('https://lh3.googleusercontent.com/a/photo')).toBe(false);
    expect(isSafeAvatar('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeAvatar('data:image/png;base64,AA"onerror=x')).toBe(false);
    expect(isSafeAvatar(`data:image/png;base64,${'A'.repeat(60_000)}`)).toBe(false);
  });

  it('trims names and refuses blank or control characters', () => {
    expect(AccountProfileSchema.parse({ displayName: '  Sam  ' }).displayName).toBe('Sam');
    expect(AccountProfileSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(AccountProfileSchema.safeParse({ displayName: 'a\u0007b' }).success).toBe(false);
    expect(AccountProfileSchema.safeParse({ displayName: 'x'.repeat(51) }).success).toBe(false);
  });

  it('gives each email a stable colour', () => {
    expect(avatarHue('sam@example.com')).toBe(avatarHue('sam@example.com'));
    expect(avatarHue('sam@example.com')).toBeLessThan(360);
  });
});
