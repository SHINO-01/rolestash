import { day, endOfDay, literal, parseArgs, sqlFor, UsageError } from '../../../scripts/grants';

describe('scripts/grants.ts (ADR-0035)', () => {
  it('parses grant, revoke and list, dry run by default', () => {
    expect(
      parseArgs([
        'grant',
        'dana@example.com',
        '--reason',
        'team',
        '--until',
        '2027-01-31',
        '--note',
        'Hi',
      ]),
    ).toEqual({
      kind: 'grant',
      email: 'dana@example.com',
      reason: 'team',
      until: '2027-01-31',
      note: 'Hi',
      by: 'owner',
      apply: false,
      local: false,
    });
    expect(parseArgs(['revoke', 'dana@example.com', '--apply', '--local'])).toEqual({
      kind: 'revoke',
      email: 'dana@example.com',
      by: 'owner',
      apply: true,
      local: true,
    });
    expect(parseArgs(['list', '--all'])).toEqual({ kind: 'list', all: true, local: false });
  });

  it.each([
    [[], /list, grant or revoke/],
    [['grant', 'dana@example.com'], /--reason is one of/],
    [['grant', 'dana@example.com', '--reason', 'friend'], /--reason is one of/],
    [['grant', 'dana', '--reason', 'team'], /Not an email/],
    [['grant', 'dana@example.com', '--reason', 'team', '--until', '31/01/2027'], /YYYY-MM-DD/],
    [['grant', 'dana@example.com', '--reason'], /needs a value/],
    [['revoke'], /needs one email/],
    [['revoke', 'a@b.co', 'c@d.co'], /needs one email/],
    [['list', '--force'], /Unknown option/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it('quotes text safely and ends dated grants at the end of a Sydney day', () => {
    expect(literal("o'neil@example.com")).toBe("'o''neil@example.com'");
    expect(literal(undefined)).toBe('null');
    expect(() => literal('a\0b')).toThrow(UsageError);
    expect(endOfDay('2027-01-31')).toBe(
      "('2027-01-31 23:59:59'::timestamp at time zone 'Australia/Sydney')",
    );
    expect(day('2026-10-06T14:00:00+00:00')).toBe('2026-10-07');
    expect(day('9999-12-31T00:00:00+00:00')).toBe('indefinite');
  });

  it('only reads on a dry run, and calls the database functions with --apply', () => {
    const grant = parseArgs(['grant', "o'neil@example.com", '--reason', 'tester']);
    expect(sqlFor(grant)).not.toMatch(/grant_access|revoke_access/);
    expect(
      sqlFor(parseArgs(['grant', "o'neil@example.com", '--reason', 'tester', '--apply'])),
    ).toBe(
      "select private.grant_access('o''neil@example.com', 'tester', null, null, 'owner') as outcome",
    );
    const revoke = parseArgs(['revoke', 'dana@example.com', '--note', 'Done', '--apply']);
    expect(sqlFor(revoke)).toBe(
      "select private.revoke_access('dana@example.com', 'Done', 'owner') as outcome",
    );
    expect(sqlFor(parseArgs(['list']))).toMatch(/private\.list_grants\(false\)/);
  });
});
