/**
 * Snapshots a live job application form as a scrubbed autofill fixture
 * (docs/guides/autofill.md, "Capture a real form").
 *
 * Usage:
 *   npx tsx scripts/snapshot-form.ts <ats> <case> <url> [Real=Fictional ...]
 *
 * Renders the page in Chromium (no extension, no cookies, a fresh profile),
 * scrubs it like the job-page snapshots (scripts/lib/scrub.ts), keeps only
 * the application form (dropdowns trimmed to 25 options), and replaces each `Real=Fictional` name (case-sensitive; pass each spelling) so fixtures
 * only ever show fictional companies. Writes tests/fixtures/forms/<ats>/<case>.html
 * and prints what the autofill matcher finds, to check before writing
 * <case>.expected.json by hand. Set HEADED=1 for sites that challenge
 * headless browsers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { Window } from 'happy-dom';
import { scanForm } from '../src/autofill';
import { scrubDocument } from './lib/scrub';

const [ats, name, url, ...pairs] = process.argv.slice(2);
if (!ats || !name || !url) {
  console.error('Usage: npx tsx scripts/snapshot-form.ts <ats> <case> <url> [Real=Fictional ...]');
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const browser = await chromium.launch({
  channel: 'chromium',
  headless: process.env.HEADED !== '1',
});
try {
  const page = await (
    await browser.newContext({ locale: 'en-AU', viewport: { width: 1366, height: 900 } })
  ).newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const full = await page.evaluate(scrubDocument);

  // Keep only the form (the biggest <form>, or the page body when there isn't one).
  const window = new Window({ url: page.url() });
  window.document.write(full);
  const doc = window.document as unknown as Document;
  const forms = [...doc.querySelectorAll('form')].sort(
    (a, b) =>
      b.querySelectorAll('input, select, textarea').length -
      a.querySelectorAll('input, select, textarea').length,
  );
  const form = forms[0];
  // Long dropdowns (every university, every country) only slow tests down: keep 25 options.
  for (const select of (form ?? doc).querySelectorAll('select'))
    [...select.querySelectorAll('option')].slice(25).forEach((o) => o.remove());
  let html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Application</title></head><body>\n${form ? form.outerHTML : doc.body.innerHTML}\n</body></html>\n`;
  for (const pair of pairs) {
    const [real, fictional] = pair.split('=');
    if (real && fictional)
      html = html.replace(new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), fictional);
  }

  const dir = join(ROOT, 'tests/fixtures/forms', ats);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);

  const check = new Window({ url: page.url() });
  check.document.write(html);
  const fields = scanForm(check.document as unknown as Document);
  console.log(
    `Wrote ${file.replace(`${ROOT}/`, '')} (${String(Math.round(html.length / 1024))} KB), ${String(fields.length)} fields`,
  );
  for (const f of fields)
    console.log(`  ${(f.key ?? '·').padEnd(18)} ${f.kind.padEnd(8)} ${f.label.slice(0, 70)}`);
} finally {
  await browser.close();
}
