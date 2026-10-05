import { extractJob } from '@/extraction';
import { factsFromDescription } from '@/extraction/normalize/description-facts';

describe('facts from the description', () => {
  it('reads labelled lines', () => {
    const text = [
      'About the role',
      '• Job location: Macquarie Park, NSW, AU, 2113',
      'Salary range: $158,393 – $177,399 per annum + super',
      'Work arrangement: Hybrid (3 days in the office)',
    ].join('\n');
    expect(factsFromDescription(text, 'AUD')).toEqual({
      location: 'Macquarie Park, NSW, AU, 2113',
      salary: expect.objectContaining({
        min: 158_393,
        max: 177_399,
        currency: 'AUD',
        period: 'year',
      }) as unknown,
      workplaceType: 'hybrid',
    });
  });

  it('reads pay from a sentence, with its period', () => {
    expect(
      factsFromDescription('We offer a base salary of £45k–55k per annum and great people.').salary,
    ).toMatchObject({ min: 45_000, max: 55_000, currency: 'GBP', period: 'year' });
    expect(factsFromDescription('Pay: $38.50 per hour, weekly.', 'AUD').salary).toMatchObject({
      min: 38.5,
      period: 'hour',
      currency: 'AUD',
    });
  });

  it('ignores money that is not pay, and pay without an amount', () => {
    for (const text of [
      'We raised $50 million in our Series B to grow the team.',
      'Salary: Competitive, plus equity.',
      'A $2bn company with 5+ years of growth.',
      'Experience with 3-5 years of Python.',
    ])
      expect(factsFromDescription(text, 'USD').salary, text).toBeUndefined();
  });

  it('reads the workplace from clear phrases and recruiter hashtags', () => {
    expect(
      factsFromDescription('This is a full-stack, on-site role based in Parramatta.'),
    ).toMatchObject({ workplaceType: 'onsite' });
    expect(factsFromDescription('A hybrid role: 3 days a week in the office.')).toMatchObject({
      workplaceType: 'hybrid',
    });
    expect(factsFromDescription('This position is fully remote within Australia.')).toMatchObject({
      workplaceType: 'remote',
    });
    expect(factsFromDescription('Great team.\n#LI-Hybrid')).toMatchObject({
      workplaceType: 'hybrid',
    });
    expect(factsFromDescription('Location: Sydney (Hybrid)')).toMatchObject({
      location: 'Sydney (Hybrid)',
      workplaceType: 'hybrid',
    });
  });

  it('leaves the workplace empty when the text points two ways or only in passing', () => {
    for (const text of [
      'Some roles are remote; this on-site role is in Perth.',
      'Experience with hybrid cloud and remote debugging.',
      'Many teams offer hybrid options; Onsite postings need the office.',
      'Work type: Full time',
    ])
      expect(factsFromDescription(text).workplaceType, text).toBeUndefined();
  });

  it('stays fast on long, adversarial text', () => {
    const text = `${'Location '.repeat(5_000)}\n${'salary $'.repeat(5_000)}\n${'a '.repeat(50_000)}`;
    const start = performance.now();
    factsFromDescription(text);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('fills only what the page left empty, at low confidence', () => {
    const doc = new DOMParser().parseFromString(
      `<html><head><title>Platform Engineer | Acme</title></head><body><main><h1>Platform Engineer</h1>
       <p>Join Acme's platform team to build the systems every product runs on, and help us scale.</p>
       <p>Location: Brisbane QLD</p><p>Salary: A$140,000 – A$160,000 + super</p>
       <p>This is a hybrid role with two days a week in the office and the rest wherever suits you.</p>
       <p>${'We value curiosity, kindness and ownership. '.repeat(4)}</p></main></body></html>`,
      'text/html',
    );
    const result = extractJob(doc, 'https://careers.acme.example/jobs/42');
    expect(result.fields).toMatchObject({
      location: 'Brisbane QLD',
      salary: { min: 140_000, max: 160_000, currency: 'AUD' },
      workplaceType: 'hybrid',
    });
    expect(result.provenance.location).toEqual({ strategy: 'heuristic', confidence: 0.5 });
  });
});
