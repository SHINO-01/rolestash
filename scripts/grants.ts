/**
 * Complimentary Pro grants (ADR-0035): give, end and list them. Every change
 * runs the database's own functions (supabase/migrations/…_grants.sql), so
 * the log, pending-by-email and the restore on revoke behave the same here
 * as in the daily expiry job.
 *
 *   set -a; . ./secrets.env; set +a
 *   npx tsx scripts/grants.ts list [--all]
 *   npx tsx scripts/grants.ts grant <email> --reason team [--until 2027-01-31] [--note "…"] [--apply]
 *   npx tsx scripts/grants.ts revoke <email> [--note "…"] [--apply]
 *
 * Changes are a dry run unless --apply is given. --until is a date in
 * Sydney: the grant ends at the end of that day. Reasons: owner, team,
 * tester, partner, support, referral. A grant for an email with no account
 * waits and applies when that mailbox first signs in (aliases included).
 *
 * Production goes through the Supabase management API with
 * SUPABASE_ACCESS_TOKEN (no service-role key needed). --local runs against
 * the local stack (`supabase start`) through its Docker container.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REASONS = ['owner', 'team', 'tester', 'partner', 'support', 'referral'] as const;
export type Reason = (typeof REASONS)[number];

const PROJECT_REF = 'fhclnxqumcdsqxyunelp';
const LOCAL_CONTAINER = 'supabase_db_rolestash';

export type Command =
  | { kind: 'list'; all: boolean; local: boolean }
  | {
      kind: 'grant';
      email: string;
      reason: Reason;
      until?: string;
      note?: string;
      by: string;
      apply: boolean;
      local: boolean;
    }
  | { kind: 'revoke'; email: string; note?: string; by: string; apply: boolean; local: boolean };

export class UsageError extends Error {}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses the command line (without `node script`). Throws UsageError. */
export function parseArgs(argv: readonly string[]): Command {
  const [kind, ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (['all', 'apply', 'local'].includes(name)) flags.set(name, true);
    else if (['reason', 'until', 'note', 'by'].includes(name)) {
      const value = rest[++i];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`--${name} needs a value`);
      flags.set(name, value);
    } else throw new UsageError(`Unknown option --${name}`);
  }
  const text = (name: string) => {
    const value = flags.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const local = flags.has('local');
  const apply = flags.has('apply');
  const by = text('by') ?? 'owner';
  const note = text('note');
  if (note !== undefined && note.length > 500)
    throw new UsageError('Keep --note to 500 characters');

  if (kind === 'list') {
    if (positional.length) throw new UsageError('list takes no email');
    return { kind, all: flags.has('all'), local };
  }
  if (kind !== 'grant' && kind !== 'revoke') throw new UsageError('Use list, grant or revoke');
  const [email, ...extra] = positional;
  if (!email || extra.length) throw new UsageError(`${kind} needs one email`);
  if (!EMAIL.test(email)) throw new UsageError(`Not an email address: ${email}`);

  if (kind === 'revoke') return { kind, email, by, apply, local, ...(note ? { note } : {}) };

  const reason = text('reason');
  if (!reason || !(REASONS as readonly string[]).includes(reason))
    throw new UsageError(`--reason is one of ${REASONS.join(', ')}`);
  const until = text('until');
  if (until !== undefined && (!DATE.test(until) || Number.isNaN(Date.parse(until))))
    throw new UsageError('--until is a date: YYYY-MM-DD');
  return {
    kind,
    email,
    reason: reason as Reason,
    by,
    apply,
    local,
    ...(until ? { until } : {}),
    ...(note ? { note } : {}),
  };
}

/** A SQL string literal. Standard strings: only the quote needs doubling. */
export function literal(value: string | undefined): string {
  if (value === undefined) return 'null';
  if (value.includes('\0')) throw new UsageError('Text cannot contain a NUL character');
  return `'${value.replaceAll("'", "''")}'`;
}

/** The end of a Sydney day, as a timestamptz expression. */
export function endOfDay(date: string | undefined): string {
  return date === undefined
    ? 'null'
    : `(${literal(`${date} 23:59:59`)}::timestamp at time zone 'Australia/Sydney')`;
}

/** The SQL a command runs. Dry runs only read. Every query returns rows. */
export function sqlFor(command: Command): string {
  switch (command.kind) {
    case 'list':
      return `select id, email, reason, expires_at, note, granted_at, state, revoked_at, revoke_note from private.list_grants(${command.all ? 'true' : 'false'})`;
    case 'grant':
      if (!command.apply) return preview(command.email, endOfDay(command.until));
      return `select private.grant_access(${literal(command.email)}, ${literal(command.reason)}, ${endOfDay(command.until)}, ${literal(command.note)}, ${literal(command.by)}) as outcome`;
    case 'revoke':
      if (!command.apply) return preview(command.email, 'null');
      return `select private.revoke_access(${literal(command.email)}, ${literal(command.note)}, ${literal(command.by)}) as outcome`;
  }
}

/** What a change would touch: the account (if any), its plan, and its active grant. */
function preview(email: string, until: string): string {
  return `with u as (select private.user_for_email(${literal(email)}) as id)
select (u.id is not null) as has_account,
       e.status, e.complimentary, e.current_period_end,
       (select g.reason || coalesce(' until ' || to_char(g.expires_at at time zone 'Australia/Sydney', 'YYYY-MM-DD'), ', indefinite')
          from private.grants g
         where g.revoked_at is null
           and (g.user_id = u.id or (g.user_id is null and g.email_claim = private.email_claim(${literal(email)})))
         order by g.granted_at desc limit 1) as active_grant,
       ${until} as would_end
  from u left join public.entitlements e on e.user_id = u.id`;
}

/** A result row: the functions return text, numbers, booleans and timestamps (as text). */
type Row = Record<string, string | number | boolean | null>;

async function run(sql: string, local: boolean): Promise<Row[]> {
  if (local) {
    const out = execFileSync(
      'docker',
      [
        'exec',
        '-i',
        LOCAL_CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `select coalesce(json_agg(t), '[]') from (${sql}) t`,
      ],
      { encoding: 'utf8' },
    );
    return JSON.parse(out.trim()) as Row[];
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new UsageError('Missing SUPABASE_ACCESS_TOKEN (set -a; . ./secrets.env)');
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Database said ${String(response.status)}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as Row[];
}

/** A date as YYYY-MM-DD in Sydney, where the grants' days end. */
export function day(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  if (value.startsWith('9999-')) return 'indefinite';
  const at = new Date(value.includes('T') ? value : value.replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isNaN(at.getTime())
    ? value.slice(0, 10)
    : at.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function describe(command: Command, rows: Row[]): string {
  if (command.kind === 'list') {
    if (!rows.length) return command.all ? 'No grants yet.' : 'No active grants.';
    return rows
      .map((r) =>
        [
          String(r.state).padEnd(8),
          String(r.email).padEnd(32),
          String(r.reason).padEnd(9),
          r.expires_at ? `until ${day(r.expires_at)}` : 'indefinite',
          r.note ? `· ${String(r.note)}` : '',
          r.revoked_at
            ? `· revoked ${day(r.revoked_at)}${r.revoke_note ? ` (${String(r.revoke_note)})` : ''}`
            : '',
        ]
          .filter(Boolean)
          .join('  '),
      )
      .join('\n');
  }
  const row = rows[0] ?? {};
  if (command.apply) {
    const outcome = String(row.outcome);
    if (command.kind === 'revoke')
      return outcome === 'revoked'
        ? `Revoked. ${command.email} is back on its own plan (subscription, trial or Free).`
        : `Nothing to revoke for ${command.email}.`;
    return outcome === 'pending'
      ? `Saved. ${command.email} has no account yet; Pro applies when it first signs in.`
      : `Granted. ${command.email} has Pro (${command.reason}) ${command.until ? `until the end of ${command.until} (Sydney)` : 'indefinitely'}.`;
  }
  const account = row.has_account
    ? `${command.email}: account on ${row.complimentary ? `a ${String(row.complimentary)} grant` : String(row.status)}${row.active_grant ? ` (active grant: ${String(row.active_grant)})` : ''}.`
    : `${command.email}: no account yet.${row.active_grant ? ` A pending grant exists: ${String(row.active_grant)}.` : ''}`;
  const change =
    command.kind === 'grant'
      ? `Would grant Pro (${command.reason}) ${command.until ? `until the end of ${command.until}, Sydney time` : 'indefinitely'}${row.has_account ? '' : ', applied at first sign-in'}${row.active_grant ? ', replacing the active grant' : ''}.`
      : !row.active_grant && !row.complimentary
        ? 'Nothing to revoke.'
        : row.has_account
          ? 'Would revoke it and return the account to its own plan.'
          : 'Would cancel the pending grant.';
  return `${account}\n${change}\nDry run: add --apply to do it.`;
}

async function main(argv: string[]): Promise<void> {
  const command = parseArgs(argv);
  const rows = await run(sqlFor(command), command.local);
  console.log(describe(command, rows));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof UsageError)
      console.error(
        'Usage: grants.ts list [--all] | grant <email> --reason <r> [--until YYYY-MM-DD] [--note …] [--apply] | revoke <email> [--note …] [--apply]  (add --local for the local stack)',
      );
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
