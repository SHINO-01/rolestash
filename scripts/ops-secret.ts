/**
 * Sets (or rotates) the operations dashboard's admin secret (ADR-0037): a new
 * random value goes to the rolestash-ops Worker as OPS_ADMIN_SECRET, and only
 * its SHA-256 goes to the database (private.ops_admin_secret). The value is
 * never printed or written to disk.
 *
 *   set -a; . ./secrets.env; set +a     # SUPABASE_ACCESS_TOKEN; wrangler must be logged in
 *   npx tsx scripts/ops-secret.ts            # says what it would do
 *   npx tsx scripts/ops-secret.ts --apply    # does it
 *
 * Until both halves match, the dashboard's pages say "Set up changes" and
 * every change is refused.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const PROJECT_REF = 'fhclnxqumcdsqxyunelp';

if (!process.argv.includes('--apply')) {
  console.log(
    'Would make a new random OPS_ADMIN_SECRET, store it in the rolestash-ops Worker (wrangler secret put),\n' +
      'and store its SHA-256 in private.ops_admin_secret. Add --apply to do it.',
  );
  process.exit(0);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (set -a; . ./secrets.env; set +a).');
  process.exit(2);
}

const secret = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(secret, 'utf8').digest('hex');

// The database first: if the Worker step fails, the old secret simply stops working.
const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `insert into private.ops_admin_secret (sha256) values (decode('${hash}', 'hex'))
            on conflict (id) do update set sha256 = excluded.sha256`,
  }),
});
if (!response.ok) {
  console.error(
    `The database said ${String(response.status)}: ${(await response.text()).slice(0, 300)}`,
  );
  console.error(
    'Has the migration 20261022120000_programs.sql been applied (npx supabase db push)?',
  );
  process.exit(1);
}

const put = spawnSync(
  'npx',
  ['wrangler', 'secret', 'put', 'OPS_ADMIN_SECRET', '--config', 'infra/ops-worker/wrangler.jsonc'],
  { input: secret, stdio: ['pipe', 'inherit', 'inherit'] },
);
if (put.status !== 0) {
  console.error('wrangler secret put failed; run this again once wrangler is logged in.');
  process.exit(1);
}
console.log('Done: the dashboard can make changes. Reload operations.rolestash.com.');
