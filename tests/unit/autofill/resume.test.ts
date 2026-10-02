import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readResume } from '@/autofill/resume';

const DIR = join(__dirname, '../../fixtures/resumes');
const CASES = readdirSync(DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.replace(/\.txt$/, ''));

describe('reading a résumé (fixtures, fictional people)', () => {
  it.each(CASES)('%s reads as expected', (name) => {
    const text = readFileSync(join(DIR, `${name}.txt`), 'utf8');
    const expected = JSON.parse(
      readFileSync(join(DIR, `${name}.expected.json`), 'utf8'),
    ) as unknown;
    expect(readResume(text)).toEqual(expected);
  });

  it('never mistakes skills like Node.js for a website, or year ranges for a phone', () => {
    const details = readResume('Jo Bloggs\njo@example.com\nSkills\nNode.js, ASP.NET\n2019 - 2023');
    expect(details.website).toBeUndefined();
    expect(details.phone).toBeUndefined();
  });

  it('returns nothing from text that is not a résumé', () => {
    expect(readResume('')).toEqual({});
    expect(readResume('lorem ipsum dolor sit amet')).toEqual({});
  });
});
