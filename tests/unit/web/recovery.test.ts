import { takeRecovery } from '@/web/recovery';

const at = (search: string, hash: string) =>
  ({ search, hash, pathname: '/board/' }) as unknown as Location;
const jwt = (claims: object) =>
  `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('password reset links (ADR-0036)', () => {
  it('reads the one-time session and whose it is, then clears the address', () => {
    const replace = vi.spyOn(history, 'replaceState');
    const token = jwt({ email: 'jo@example.com' });
    expect(takeRecovery(at('?reset=1', `#access_token=${token}&type=recovery`))).toEqual({
      token,
      email: 'jo@example.com',
    });
    expect(replace).toHaveBeenCalledWith(null, '', '/board/');
  });

  it('explains an expired or used link', () => {
    expect(
      takeRecovery(at('?reset=1', '#error=access_denied&error_code=otp_expired')),
    ).toMatchObject({ error: expect.stringContaining('expired') as unknown });
    expect(takeRecovery(at('?reset=1', '#type=signup&access_token=x'))).toHaveProperty('error');
  });

  it('ignores ordinary visits', () => {
    expect(takeRecovery(at('', '#access_token=x&type=recovery'))).toBeNull();
  });
});
