import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';

/** The form fixtures, each with the URL it was captured from (fictional companies). */
export const FORM_FIXTURES = {
  'greenhouse/live-2026-10': 'https://job-boards.greenhouse.io/northwind/jobs/8638232002',
  'lever/live-2026-10': 'https://jobs.lever.co/bluegum/ac978161-6f46-4f6b-ad9e-a258e642751c/apply',
  'ashby/live-2026-10':
    'https://jobs.ashbyhq.com/kestrel/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application',
  'workday/my-information':
    'https://harbourline.wd3.myworkdayjobs.com/en-US/External/job/Sydney/Analyst_R-1/apply',
  'smartrecruiters/one-click':
    'https://jobs.smartrecruiters.com/oneclick-ui/company/Harbourline/publication/1',
  'generic/careers-page': 'https://careers.saltbushenergy.example/apply',
} as const;
export type FormFixture = keyof typeof FORM_FIXTURES;

const DIR = join(__dirname, '../../fixtures/forms');

/** A fresh document for a fixture, at its URL (so the system is detected). */
export function loadForm(name: FormFixture): Document {
  const window = new Window({ url: FORM_FIXTURES[name] });
  window.document.write(readFileSync(join(DIR, `${name}.html`), 'utf8'));
  return window.document as unknown as Document;
}
