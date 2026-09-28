import { extractJob } from '@/extraction';
import {
  findJobPostings,
  locationFromJobLocation,
  parseLenient,
} from '@/extraction/strategies/json-ld';
import { firstMatch, parseSelector } from '@/extraction/strategies/shared';
import { htmlDoc, jsonLdDoc } from '../helpers/dom';

describe('JSON-LD', () => {
  it('repairs common breakage', () => {
    expect(parseLenient('{"a": 1,}')).toEqual({ a: 1 });
    expect(parseLenient('{"a": "line\nbreak"}')).toEqual({ a: 'line break' });
    expect(parseLenient('<![CDATA[{"a":1}]]>')).toEqual({ a: 1 });
    expect(parseLenient('nope')).toBeUndefined();
  });

  it('finds JobPosting in arrays, @graph and nested nodes; accepts IRI types', () => {
    const data = [
      { '@type': 'WebPage', mainEntity: { '@type': 'JobPosting', title: 'A' } },
      { '@graph': [{ '@type': ['Thing', 'JobPosting'], title: 'B' }] },
      { '@type': 'http://schema.org/JobPosting', title: 'C' },
    ];
    expect(findJobPostings(data).map((n) => n.title)).toEqual(['A', 'B', 'C']);
  });

  it('formats locations and caps long lists', () => {
    const place = (city: string) => ({
      '@type': 'Place',
      address: { addressLocality: city, addressCountry: { name: 'AU' } },
    });
    expect(locationFromJobLocation(place('Sydney'))).toBe('Sydney, AU');
    expect(locationFromJobLocation(['Perth', 'Brisbane'].map(place))).toBe(
      'Perth, AU; Brisbane, AU',
    );
    expect(locationFromJobLocation(['A', 'B', 'C', 'D', 'E'].map(place))).toBe(
      'A, AU; B, AU +3 more',
    );
  });

  it('marks remote postings and describes the applicant region', () => {
    const doc = jsonLdDoc({
      '@type': 'JobPosting',
      title: 'Remote Dev',
      hiringOrganization: 'Acme',
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: { '@type': 'Country', name: 'Australia' },
    });
    const { fields } = extractJob(doc, 'https://example.com/job');
    expect(fields.workplaceType).toBe('remote');
    expect(fields.location).toBe('Remote (Australia)');
  });

  it('prefers the posting whose url matches the page when several exist', () => {
    const doc = jsonLdDoc([
      {
        '@type': 'JobPosting',
        title: 'Other',
        url: 'https://example.com/jobs/1',
        hiringOrganization: 'X',
      },
      {
        '@type': 'JobPosting',
        title: 'This one',
        url: 'https://example.com/jobs/2',
        hiringOrganization: 'Y',
      },
    ]);
    const result = extractJob(doc, 'https://example.com/jobs/2?utm_source=x');
    expect(result.fields.title).toBe('This one');
    expect(result.provenance.title?.confidence).toBe(0.95);
  });

  it('lowers confidence when several postings are ambiguous (list pages)', () => {
    const doc = jsonLdDoc([
      { '@type': 'JobPosting', title: 'One', hiringOrganization: 'X' },
      { '@type': 'JobPosting', title: 'Two', hiringOrganization: 'Y' },
    ]);
    expect(extractJob(doc, 'https://example.com/search').provenance.title?.confidence).toBe(0.6);
  });

  it('survives garbage without throwing', () => {
    const doc = jsonLdDoc('{"@type": "JobPosting", "title": ');
    expect(() => extractJob(doc, 'https://example.com/')).not.toThrow();
  });
});

describe('selectors', () => {
  it('supports @attr suffix', () => {
    expect(parseSelector('img.logo@alt')).toEqual({ css: 'img.logo', attr: 'alt' });
    expect(parseSelector('a[href*="@"]')).toEqual({ css: 'a[href*="@"]' });
    expect(parseSelector('h1')).toEqual({ css: 'h1' });
  });

  it('skips empty matches and invalid selectors', () => {
    const doc = htmlDoc('<h1> </h1><h2>Real</h2>');
    expect(firstMatch(doc, ['h1', '::invalid(', 'h2'])?.text).toBe('Real');
  });

  it('joins all matches when asked (pill lists)', () => {
    const doc = htmlDoc('<ul><li class="p">Hybrid</li><li class="p">Full-time</li></ul>');
    expect(firstMatch(doc, ['.p'], true)?.text).toBe('Hybrid · Full-time');
  });
});

describe('pipeline', () => {
  it('drops a company that is really the job board name', () => {
    const doc = htmlDoc(
      '<html><head><meta property="og:site_name" content="SEEK"><title>x</title></head><body><h1 data-automation="job-detail-title">Dev</h1></body></html>',
    );
    expect(extractJob(doc, 'https://www.seek.com.au/job/1').fields.company).toBeUndefined();
  });

  it('flags pages that are not job postings', () => {
    const doc = htmlDoc('<html><head><title>News</title></head><body><p>Hello</p></body></html>');
    const result = extractJob(doc, 'https://news.example.com/');
    expect(result.isJobPage).toBe(false);
    expect(result.warnings).toContain('This page may not be a single job posting.');
  });

  it('JSON-LD wins over adapter selectors on ties of trust', () => {
    const doc =
      htmlDoc(`<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"From JSON-LD","hiringOrganization":"Acme"}</script></head>
      <body><h1 data-automation="job-detail-title">From selector</h1></body></html>`);
    expect(extractJob(doc, 'https://www.seek.com.au/job/1').fields.title).toBe('From JSON-LD');
  });

  it('handles unparsable URLs', () => {
    expect(extractJob(htmlDoc(''), 'not a url').warnings[0]).toMatch(/URL/);
  });
});
