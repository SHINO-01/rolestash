import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeEmail, EmailEventSchema, type EmailEvent, type EmailInput } from '@/email';

/**
 * The email corpus (ADR-0014 §5, "Measurement"): every fixture in
 * tests/fixtures/emails/ must produce its expected intent and action, and
 * automatic changes (`apply`) must be 100% precise. Add a fixture for every
 * miss. Fictional companies only.
 */

interface Fixture {
  description: string;
  input: EmailInput;
  expected: Partial<Omit<EmailEvent, 'interview' | 'verification'>> & {
    intent: EmailEvent['intent'];
    action: EmailEvent['action'];
    interview?: Partial<NonNullable<EmailEvent['interview']>>;
    verification?: EmailEvent['verification'];
  };
}

const DIR = join(__dirname, '../../fixtures/emails');
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f.replace(/\.json$/, ''),
    ...(JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture),
  }));

describe('email corpus', () => {
  it('has fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
  });

  it.each(fixtures)('$name: $description', ({ input, expected }) => {
    const event = analyzeEmail(input);
    expect(EmailEventSchema.parse(event)).toEqual(event);
    expect({ intent: event.intent, action: event.action }, event.reasons.join('\n')).toEqual({
      intent: expected.intent,
      action: expected.action,
    });
    for (const key of ['ats', 'atsJobId', 'companyHint', 'titleHint'] as const) {
      if (expected[key] !== undefined) expect(event[key], key).toBe(expected[key]);
    }
    if (expected.interview) expect(event.interview).toMatchObject(expected.interview);
    if (expected.verification) expect(event.verification).toEqual(expected.verification);
  });

  it('applies changes with 100% precision and meets every expected action', () => {
    const rows = fixtures.map((f) => ({
      name: f.name,
      expected: f.expected,
      event: analyzeEmail(f.input),
    }));
    const applied = rows.filter((r) => r.event.action === 'apply');
    const wrongApplies = applied.filter((r) => r.event.intent !== r.expected.intent);
    const missed = rows.filter(
      (r) => r.event.action !== r.expected.action || r.event.intent !== r.expected.intent,
    );

    const byIntent = new Map<
      string,
      { total: number; apply: number; suggest: number; none: number }
    >();
    for (const r of rows) {
      const row = byIntent.get(r.expected.intent) ?? { total: 0, apply: 0, suggest: 0, none: 0 };
      row.total++;
      row[r.event.action]++;
      byIntent.set(r.expected.intent, row);
    }
    console.table(Object.fromEntries(byIntent));

    expect(wrongApplies.map((r) => r.name)).toEqual([]);
    expect(missed.map((r) => r.name)).toEqual([]);
  });
});
