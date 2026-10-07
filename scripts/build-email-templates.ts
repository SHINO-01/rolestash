/**
 * Writes the Supabase Auth email templates from the shared email layout, so
 * the sign-in code looks like every other Rolestash email. Paste the result
 * into Supabase (Authentication → Emails → Magic Link and Confirm signup);
 * a test fails if the file is stale.
 *
 * Usage: npx tsx scripts/build-email-templates.ts   (or npm run email:templates)
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signInCodeEmail } from '../supabase/functions/_shared/account-emails.ts';

const ROOT = resolve(import.meta.dirname, '..');

writeFileSync(resolve(ROOT, 'supabase/templates/sign-in-code.html'), `${signInCodeEmail().html}\n`);
console.log('Wrote supabase/templates/sign-in-code.html');
