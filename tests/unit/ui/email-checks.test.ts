import { emailCheckDue } from '@/ui/hooks/email';

describe('when an open board checks email (ADR-0014, ADR-0032)', () => {
  it('checks every minute while in view with a connected mailbox', () => {
    expect(emailCheckDue(59_000, true, true)).toBe(false);
    expect(emailCheckDue(60_000, true, true)).toBe(true);
  });

  it('otherwise every five minutes (forwarding only, or out of view)', () => {
    expect(emailCheckDue(60_000, true, false)).toBe(false);
    expect(emailCheckDue(60_000, false, true)).toBe(false);
    expect(emailCheckDue(5 * 60_000, false, true)).toBe(true);
    expect(emailCheckDue(5 * 60_000, true, false)).toBe(true);
  });
});
