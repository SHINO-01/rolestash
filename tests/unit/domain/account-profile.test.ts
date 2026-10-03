import {
  AccountProfileSchema,
  avatarHue,
  firstNameFrom,
  initials,
  isSafeAvatar,
} from '@/domain/account-profile';

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
    // Legal names can be long (ADR-0024): up to 100 characters, like the database.
    expect(AccountProfileSchema.safeParse({ displayName: 'x'.repeat(100) }).success).toBe(true);
    expect(AccountProfileSchema.safeParse({ displayName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('gives each email a stable colour', () => {
    expect(avatarHue('sam@example.com')).toBe(avatarHue('sam@example.com'));
    expect(avatarHue('sam@example.com')).toBeLessThan(360);
  });

  it('finds a first name from the provider, or else the email address', () => {
    expect(firstNameFrom('Sakif Hussain', 'x@example.com')).toBe('Sakif');
    expect(firstNameFrom('Ailsa McKenzie', undefined)).toBe('Ailsa');
    expect(firstNameFrom('McKenzie', undefined)).toBe('McKenzie');
    expect(firstNameFrom(undefined, 'sakifhussain33@gmail.com')).toBe('Sakifhussain');
    expect(firstNameFrom(undefined, 'sam.taylor@example.com')).toBe('Sam');
    expect(firstNameFrom(undefined, 'JO_bloggs+jobs@example.com')).toBe('Jo');
    expect(firstNameFrom('  ', '12345@example.com')).toBeUndefined();
    expect(firstNameFrom(undefined, undefined)).toBeUndefined();
  });
});
