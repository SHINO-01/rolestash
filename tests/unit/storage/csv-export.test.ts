import { DEFAULT_STAGES } from '@/domain/stage';
import { csvCell, jobsToCsv, localDate } from '@/storage/csv-export';
import { makeJob } from '../helpers/factories';

/** Minimal RFC 4180 reader, enough to check what a spreadsheet will see. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    const next = text.charAt(i + 1);
    if (quoted) {
      if (c === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else {
      cell += c;
    }
  }
  return rows;
}

describe('CSV export', () => {
  const jobs = [
    makeJob({ id: 'b', title: 'Later', stageId: 'applied', rank: 1, company: 'Beta' }),
    makeJob({
      id: 'a',
      title: 'Engineer, "Platform"',
      company: 'Northwind Labs',
      stageId: 'saved',
      rank: 2,
      priority: 3,
      location: 'Sydney NSW',
      workplaceType: 'hybrid',
      employmentTypes: ['full-time', 'contract'],
      salary: { min: 150000, max: 175000, currency: 'AUD', period: 'year', text: 'A$150k–175k' },
      tags: ['react', 'go'],
      closesAt: '2026-10-14',
      notes: 'Line one\nLine two',
      description: 'x'.repeat(40_000),
    }),
    makeJob({ id: 'c', title: 'First', stageId: 'saved', rank: 1 }),
    makeJob({
      id: 'm',
      title: 'By hand',
      stageId: 'offer',
      source: {
        url: 'https://rolestash.invalid/manual/abc',
        originalUrl: 'https://rolestash.invalid/manual/abc',
        siteId: 'manual',
        siteName: 'Manual',
        capturedAt: '2026-09-01T00:00:00.000Z',
      },
    }),
  ];
  const text = jobsToCsv(jobs, DEFAULT_STAGES);
  const rows = parseCsv(text.slice(1));
  const header = rows[0] ?? [];
  const col = (row: string[] | undefined, name: string) => row?.[header.indexOf(name)];

  it('starts with a BOM and uses CRLF, so Excel reads UTF-8 correctly', () => {
    expect(text.startsWith('﻿Title,Company,Stage')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('lists jobs in board order: by stage, then rank', () => {
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      'First',
      'Engineer, "Platform"',
      'Later',
      'By hand',
    ]);
  });

  it('flattens every field into readable columns', () => {
    const row = rows[2];
    expect(col(row, 'Stage')).toBe('Saved');
    expect(col(row, 'Priority')).toBe('High');
    expect(col(row, 'Workplace')).toBe('Hybrid');
    expect(col(row, 'Employment')).toBe('full-time, contract');
    expect(col(row, 'Salary min')).toBe('150000');
    expect(col(row, 'Currency')).toBe('AUD');
    expect(col(row, 'Tags')).toBe('react, go');
    expect(col(row, 'Closes')).toBe('2026-10-14');
    expect(col(row, 'Notes')).toBe('Line one\nLine two');
    expect(col(row, 'Posting link')).toBe('https://example.com/jobs/a');
    expect(col(row, 'Description')?.length).toBe(32_001);
  });

  it('leaves the link blank for jobs added by hand', () => {
    expect(col(rows[4], 'Posting link')).toBe('');
    expect(col(rows[4], 'Source')).toBe('Added by hand');
  });

  it('neutralises cells a spreadsheet would run as formulas', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1', '-2+3', '@SUM(A1)', '\tx'])
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell(-5)).toBe('-5'); // real numbers stay numbers
    expect(csvCell(undefined)).toBe('');
  });

  it('turns instants into local calendar dates', () => {
    expect(localDate(undefined)).toBe('');
    expect(localDate('nonsense')).toBe('');
    expect(localDate('2026-10-14')).toBe('2026-10-14');
    expect(localDate(new Date(2026, 0, 5, 12).toISOString())).toBe('2026-01-05');
  });
});
