import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractJob } from '@/extraction';
import { looksLikeNoJob } from '@/features/capture/capture-draft';
import { FIXTURES_DIR, fixtureDoc } from '../helpers/dom';
import { makeResult } from '../helpers/factories';

/**
 * The widget says "This doesn't look like a job posting" instead of opening a
 * job form titled after, say, a recipe (ADR-0039). It must never say so on a
 * real posting, including one on an unknown careers site.
 */
describe('not a job posting', () => {
  const sitesDir = join(FIXTURES_DIR, 'sites');
  const postings = readdirSync(sitesDir).flatMap((site) =>
    readdirSync(join(sitesDir, site))
      .filter((f) => f.endsWith('.expected.json'))
      .map((f) => ({ site, name: f.replace('.expected.json', '') })),
  );

  it.each(postings)('keeps the form for the posting $site/$name', ({ site, name }) => {
    const spec = JSON.parse(
      readFileSync(join(sitesDir, site, `${name}.expected.json`), 'utf8'),
    ) as { url: string };
    const result = extractJob(fixtureDoc(`sites/${site}/${name}.html`), spec.url);
    expect(looksLikeNoJob(result)).toBe(false);
  });

  it('says so on an article', () => {
    const doc = new DOMParser().parseFromString(
      `<html><head><title>Weekend recipes: easy pasta</title></head><body>
        <h1>Weekend recipes: easy pasta</h1><p>By Sam Writer, 5 min read</p>
        <p>Bring a big pot of salted water to the boil, then add the pasta.</p></body></html>`,
      'text/html',
    );
    expect(looksLikeNoJob(extractJob(doc, 'https://news.example.com/recipes/pasta'))).toBe(true);
  });

  it('says so on an application form with no posting', () => {
    const doc = fixtureDoc('forms/generic/careers-page.html');
    expect(looksLikeNoJob(extractJob(doc, 'https://apply.example.com/form'))).toBe(true);
  });

  it('trusts the extractor when it is sure', () => {
    expect(looksLikeNoJob(makeResult({ fields: { title: 'x' } }))).toBe(false);
    expect(looksLikeNoJob(makeResult({ isJobPage: false, fields: { title: 'x' } }))).toBe(true);
    expect(
      looksLikeNoJob(makeResult({ isJobPage: false, fields: { title: 'x', company: 'Acme' } })),
    ).toBe(false);
  });
});
