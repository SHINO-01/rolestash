import { checkPassword } from '@/domain/password';

describe('password rules (ADR-0036)', () => {
  it('needs 12 to 128 characters', async () => {
    expect(await checkPassword('short pass')).toMatchObject({ ok: false, problem: 'short' });
    expect(await checkPassword('x'.repeat(129))).toMatchObject({ ok: false, problem: 'long' });
  });

  it('refuses common and leaked passwords, however long', async () => {
    for (const weak of ['password1234', 'qwertyuiop123', '123456789012', 'iloveyou1234'])
      expect(await checkPassword(weak)).toMatchObject({ ok: false, problem: 'guessable' });
  });

  it('refuses passwords built from the email or the product name', async () => {
    expect(await checkPassword('dana.smith-2026!', 'dana.smith@example.com')).toMatchObject({
      ok: false,
      problem: 'personal',
    });
    expect(await checkPassword('MyRolestash#2026')).toMatchObject({ problem: 'personal' });
  });

  it('accepts a few unrelated words, with no composition rules', async () => {
    expect(await checkPassword('copper lantern violin harbour', 'dana@example.com')).toEqual({
      ok: true,
    });
  });
});
