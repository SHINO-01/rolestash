import { classifyEmploymentTypes, classifyWorkplace } from '@/extraction/normalize/classifiers';
import { parseRelativeDate, toIsoDate } from '@/extraction/normalize/dates';
import { formatSalary, parseSalaryText, salaryFromSchema } from '@/extraction/normalize/salary';
import { cleanText, decodeEntities, htmlToText, slugToName } from '@/extraction/normalize/text';
import { canonicalizeUrl, isTrackingParam } from '@/extraction/normalize/url';

describe('text', () => {
  it('cleans whitespace, nbsp and zero-width chars', () => {
    expect(cleanText('  Senior Engineer​ \n ')).toBe('Senior Engineer');
    expect(cleanText(null)).toBe('');
  });

  it('decodes entities', () => {
    expect(decodeEntities('R&amp;D &#8211; Sydney')).toBe('R&D – Sydney');
    expect(decodeEntities('plain')).toBe('plain');
  });

  it('converts HTML to readable text with bullets and paragraphs', () => {
    const text = htmlToText(
      '<p>Intro</p><ul><li>One</li><li>Two</li></ul><p>Outro<br>line</p><script>alert(1)</script>',
    );
    expect(text).toBe('Intro\n\n• One\n• Two\n\nOutro\nline');
  });

  it('handles double-encoded HTML (common in JSON-LD)', () => {
    expect(htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;')).toBe('Hello & welcome');
  });

  it('never executes or keeps markup', () => {
    expect(htmlToText('<img src=x onerror="window.pwned=1"><b>Safe</b>')).toBe('Safe');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it('turns slugs into names', () => {
    expect(slugToName('acme-corp')).toBe('Acme Corp');
  });
});

describe('salary', () => {
  it.each([
    [
      '$120,000 – $140,000 + super',
      'AUD',
      { min: 120000, max: 140000, currency: 'AUD', period: 'year' },
    ],
    ['£45k-55k per annum', undefined, { min: 45000, max: 55000, currency: 'GBP', period: 'year' }],
    ['$55 - $65 per hour', 'AUD', { min: 55, max: 65, currency: 'AUD', period: 'hour' }],
    ['AUD 150k–170k', undefined, { min: 150000, max: 170000, currency: 'AUD', period: 'year' }],
    ['US$180K/yr', undefined, { min: 180000, currency: 'USD', period: 'year' }],
    ['€60.000 - €75.000', undefined, { min: 60000, max: 75000, currency: 'EUR' }],
    ['12-18 Lacs P.A.', undefined, { min: 1200000, max: 1800000, currency: 'INR', period: 'year' }],
    ['$800 per day', undefined, { min: 800, period: 'day' }],
  ])('parses %s', (text, currency, expected) => {
    expect(parseSalaryText(text, currency)).toMatchObject(expected);
  });

  it('leaves "$" without a currency when there is no default', () => {
    expect(parseSalaryText('$100,000')?.currency).toBeUndefined();
  });

  it('does not mistake experience or postcodes for pay', () => {
    expect(parseSalaryText('5+ years experience')?.min).toBeUndefined();
    expect(parseSalaryText('Sydney NSW 2000')?.min).toBeUndefined();
  });

  it('keeps non-numeric salary as text', () => {
    expect(parseSalaryText('Competitive salary')).toEqual({ text: 'Competitive salary' });
  });

  it('reads schema.org MonetaryAmount', () => {
    expect(
      salaryFromSchema({
        currency: 'aud',
        value: { minValue: '90000', maxValue: 110000, unitText: 'YEAR' },
      }),
    ).toEqual({ min: 90000, max: 110000, currency: 'AUD', period: 'year' });
    expect(salaryFromSchema({ currency: 'USD', value: 50, unitText: 'HOUR' })).toMatchObject({
      min: 50,
      period: 'hour',
    });
    expect(salaryFromSchema(null)).toBeUndefined();
  });

  it('formats for display', () => {
    expect(
      formatSalary({ min: 120000, max: 140000, currency: 'AUD', period: 'year' }, 'en-AU'),
    ).toMatch(/120K – 140K \/ yr/);
    expect(formatSalary({ text: 'Competitive' })).toBe('Competitive');
    expect(formatSalary(undefined)).toBeUndefined();
  });
});

describe('dates', () => {
  const now = new Date('2026-09-28T12:00:00');
  it.each([
    ['Posted 3d ago', '2026-09-25'],
    ['2 weeks ago', '2026-09-14'],
    ['Reposted 1 month ago', '2026-08-29'],
    ['today', '2026-09-28'],
    ['yesterday', '2026-09-27'],
    ['Posted 30+ days ago', '2026-08-29'],
  ])('relative: %s', (text, expected) => {
    expect(parseRelativeDate(text, now) ?? toIsoDate(text, now)).toBe(expected);
  });

  it('absolute dates', () => {
    expect(toIsoDate('2026-10-01', now)).toBe('2026-10-01');
    expect(toIsoDate('2026-10-01T09:00:00+10:00', now)).toBe('2026-09-30T23:00:00.000Z');
    expect(toIsoDate('1 Oct 2026', now)).toBe('2026-10-01');
    expect(toIsoDate('not a date', now)).toBeUndefined();
    expect(toIsoDate('1999-01-01', now)).toBe('1999-01-01');
    expect(toIsoDate('Posted on 31 December 1970', now)).toBeUndefined();
  });
});

describe('classifiers', () => {
  it('employment types', () => {
    expect(classifyEmploymentTypes(['FULL_TIME', 'CONTRACTOR'])).toEqual(['full-time', 'contract']);
    expect(classifyEmploymentTypes('Casual/Vacation')).toEqual(['casual']);
    expect(classifyEmploymentTypes('Graduate program')).toEqual(['graduate']);
    expect(classifyEmploymentTypes(42)).toEqual([]);
  });

  it('workplace', () => {
    expect(classifyWorkplace('Sydney NSW (Hybrid)')).toBe('hybrid');
    expect(classifyWorkplace('Remote - Australia')).toBe('remote');
    expect(classifyWorkplace('TELECOMMUTE')).toBe('remote');
    expect(classifyWorkplace('On-site')).toBe('onsite');
    expect(classifyWorkplace('Sydney')).toBeUndefined();
  });
});

describe('url canonicalisation', () => {
  it('strips tracking, www, fragment and trailing slash; sorts params', () => {
    expect(
      canonicalizeUrl(
        'http://WWW.Example.com/jobs/123/?utm_source=x&b=2&a=1&gclid=abc&trk=foo#apply',
      ),
    ).toBe('https://example.com/jobs/123?a=1&b=2');
  });

  it('keeps hash routes used by SPA career sites', () => {
    expect(canonicalizeUrl('https://careers.example.com/#/job/42')).toBe(
      'https://careers.example.com/#/job/42',
    );
  });

  it('keeps meaningful ids', () => {
    expect(canonicalizeUrl('https://au.indeed.com/viewjob?jk=abc&from=serp')).toBe(
      'https://au.indeed.com/viewjob?from=serp&jk=abc',
    );
    expect(isTrackingParam('jk')).toBe(false);
    expect(isTrackingParam('utm_medium')).toBe(true);
  });

  it('returns non-http URLs unchanged', () => {
    expect(canonicalizeUrl('chrome://extensions')).toBe('chrome://extensions');
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });

  it('trims every trailing slash, in linear time', () => {
    expect(canonicalizeUrl('https://example.com/jobs///')).toBe('https://example.com/jobs');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    const start = performance.now();
    canonicalizeUrl(`https://example.com/x${'/'.repeat(200_000)}x`);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
