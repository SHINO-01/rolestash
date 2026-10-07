/**
 * Writes the Supabase Auth email templates from the shared email layout, so
 * Supabase's emails look like every other Rolestash email. Paste each into
 * Supabase (Authentication → Emails; docs/guides/backend.md);
 * a test fails if the file is stale.
 *
 * Usage: npx tsx scripts/build-email-templates.ts   (or npm run email:templates)
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  passwordChangedEmail,
  passwordResetEmail,
  signInCodeEmail,
  twoStepOnEmail,
  twoStepRemovedEmail,
} from '../supabase/functions/_shared/account-emails.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** Each template file and the email it holds (Supabase's {{ .Token }} etc. stay as they are). */
export const TEMPLATES = {
  'sign-in-code.html': signInCodeEmail,
  'reset-password.html': passwordResetEmail,
  'password-changed.html': passwordChangedEmail,
  'two-step-on.html': twoStepOnEmail,
  'two-step-removed.html': twoStepRemovedEmail,
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  for (const [file, email] of Object.entries(TEMPLATES)) {
    writeFileSync(resolve(ROOT, 'supabase/templates', file), `${email().html}\n`);
    console.log(`Wrote supabase/templates/${file}`);
  }
