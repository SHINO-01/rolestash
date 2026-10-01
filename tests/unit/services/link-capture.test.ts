import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionResult } from '@/extraction';
import { LinkCaptureService, normaliseLink } from '@/services/link-capture-service';
import type { PageLoader } from '@/services/ports';
import { makeResult } from '../helpers/factories';

const FIXTURE = readFileSync(
  resolve(import.meta.dirname, '../../fixtures/sites/greenhouse/board.html'),
  'utf8',
);
const URL_ = 'https://job-boards.greenhouse.io/acme/jobs/6123456';
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

function loader(opts: {
  html?: string;
  fetchFails?: boolean;
  rendered?: ExtractionResult[];
  renderFails?: boolean;
}) {
  const calls = { fetch: 0, render: 0 };
  const l: PageLoader = {
    fetch: (url) => {
      calls.fetch++;
      return opts.fetchFails
        ? Promise.reject(new Error('blocked'))
        : Promise.resolve({ url, html: opts.html ?? FIXTURE });
    },
    render: () => {
      calls.render++;
      return opts.renderFails
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve(opts.rendered ?? []);
    },
  };
  return { l, calls };
}

describe('normaliseLink', () => {
  it('accepts web links and drops the fragment', () => {
    expect(normaliseLink(`  ${URL_}#apply `)?.href).toBe(URL_);
  });

  it.each([
    'not a link',
    'ftp://x.test/a',
    'javascript:alert(1)',
    'https://chromewebstore.google.com/detail/x',
  ])('rejects %j', (input) => expect(normaliseLink(input)).toBeUndefined());
});

describe('LinkCaptureService', () => {
  it('reads the fetched page with the same extractor, without opening a tab', async () => {
    const { l, calls } = loader({});
    const outcome = await new LinkCaptureService(l, parse).capture(URL_);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.fields.title).toBeTruthy();
    expect(outcome.result.isJobPage).toBe(true);
    expect(calls).toEqual({ fetch: 1, render: 0 });
  });

  it('renders in a background tab when the fetched page is thin', async () => {
    const rendered = makeResult({ isJobPage: true, confidence: 0.9 });
    const { l, calls } = loader({
      html: '<html><body><div id="app"></div></body></html>',
      rendered: [rendered],
    });
    const outcome = await new LinkCaptureService(l, parse).capture(URL_);
    expect(outcome).toEqual({ ok: true, result: rendered });
    expect(calls.render).toBe(1);
  });

  it('falls back to the tab when fetching fails', async () => {
    const rendered = makeResult({ isJobPage: true });
    const { l } = loader({ fetchFails: true, rendered: [rendered] });
    expect(await new LinkCaptureService(l, parse).capture(URL_)).toEqual({
      ok: true,
      result: rendered,
    });
  });

  it('explains when nothing works, and rejects bad links before loading', async () => {
    const { l, calls } = loader({ fetchFails: true, renderFails: true });
    const service = new LinkCaptureService(l, parse);
    expect(await service.capture(URL_)).toMatchObject({ ok: false, reason: 'no-result' });
    expect(await service.capture('nope')).toMatchObject({ ok: false, reason: 'restricted' });
    expect(calls.fetch).toBe(1);
  });

  it('is Pro: Free can’t use it; builds without accounts can', async () => {
    const { l } = loader({});
    const plan = (p: 'free' | 'pro') => ({ currentPlan: () => Promise.resolve(p) });
    expect(await new LinkCaptureService(l, parse, plan('free')).canUse()).toBe(false);
    expect(await new LinkCaptureService(l, parse, plan('pro')).canUse()).toBe(true);
    expect(await new LinkCaptureService(l, parse).canUse()).toBe(true);
  });
});
