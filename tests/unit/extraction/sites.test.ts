import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractJob } from '@/extraction';
import { FIXTURES_DIR, fixtureDoc } from '../helpers/dom';

/**
 * Fixture-driven regression suite: every `<case>.html` + `<case>.expected.json`
 * pair under tests/fixtures/sites/<adapter>/ becomes a test automatically.
 * See tests/fixtures/README.md.
 */

interface Expected {
  url: string;
  now?: string;
  expected: Record<string, unknown>;
}

const sitesDir = join(FIXTURES_DIR, 'sites');
const cases = readdirSync(sitesDir).flatMap((site) =>
  readdirSync(join(sitesDir, site))
    .filter((f) => f.endsWith('.expected.json'))
    .map((f) => ({ site, name: f.replace('.expected.json', '') })),
);

describe('site fixtures', () => {
  it('has fixtures', () => expect(cases.length).toBeGreaterThan(5));

  describe.each(cases)('$site/$name', ({ site, name }) => {
    const spec = JSON.parse(
      readFileSync(join(sitesDir, site, `${name}.expected.json`), 'utf8'),
    ) as Expected;
    const doc = fixtureDoc(`sites/${site}/${name}.html`);
    const result = extractJob(doc, spec.url, spec.now ? { now: new Date(spec.now) } : {});
    const e = spec.expected;

    it('resolves the site and canonical URL', () => {
      if (e.site) expect(result.site.id).toBe(e.site);
      if (e.canonicalUrl) expect(result.url).toBe(e.canonicalUrl);
    });

    it('extracts the expected fields', () => {
      const f = result.fields;
      for (const key of [
        'title',
        'company',
        'location',
        'workplaceType',
        'postedAt',
        'closesAt',
        'externalId',
      ] as const) {
        if (key in e) expect(f[key], key).toBe(e[key]);
      }
      if (e.titleStartsWith) expect(f.title?.startsWith(e.titleStartsWith as string)).toBe(true);
      if (e.employmentTypes) expect(f.employmentTypes).toEqual(e.employmentTypes);
      if (e.salary) expect(f.salary).toMatchObject(e.salary);
      if (e.descriptionContains) expect(f.description).toContain(e.descriptionContains);
      if ('isJobPage' in e) expect(result.isJobPage).toBe(e.isJobPage);
    });

    it('records provenance', () => {
      const provenance = (e.provenance ?? {}) as Record<string, string>;
      for (const [field, strategy] of Object.entries(provenance)) {
        expect(result.provenance[field as keyof typeof result.provenance]?.strategy, field).toBe(
          strategy,
        );
      }
      // Every extracted field must say where it came from.
      for (const key of Object.keys(result.fields)) {
        expect(result.provenance[key as keyof typeof result.provenance], key).toBeDefined();
      }
    });

    it('returns structured-clone-safe data (required by executeScript)', () => {
      expect(structuredClone(result)).toEqual(result);
    });
  });
});
