import { emailCheckDue } from '@/ui/hooks/email';

describe('when an open board checks email (ADR-0014, ADR-0032)', () => {
  it('checks every minute with a connected mailbox, in view or not', () => {
    expect(emailCheckDue(59_000, true)).toBe(false);
    expect(emailCheckDue(60_000, true)).toBe(true);
  });

  it('otherwise (forwarding only) every five minutes', () => {
    expect(emailCheckDue(60_000, false)).toBe(false);
    expect(emailCheckDue(5 * 60_000, false)).toBe(true);
  });
});
