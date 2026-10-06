import { DEFAULT_STAGES, type Stage } from '@/domain/stage';
import {
  analyzeEmail,
  canonicalPostingUrl,
  matchEvent,
  normalizeCompany,
  targetStage,
  type EmailEvent,
} from '@/email';
import { siteDomain, titleTokens } from '@/email/match';
import { makeJob } from '../helpers/factories';

const stages = DEFAULT_STAGES;

function event(overrides: Partial<EmailEvent> = {}): EmailEvent {
  return {
    intent: 'rejected',
    confidence: 0.9,
    action: 'apply',
    reasons: [],
    sender: { address: 'jobs@northwindlabs.example', domain: 'northwindlabs.example' },
    subject: 'Your application',
    receivedAt: '2026-10-01T00:00:00.000Z',
    postingUrls: [],
    thread: { references: [] },
    ...overrides,
  };
}

const applied = { stageId: 'applied', appliedAt: '2026-09-20T00:00:00.000Z' };

describe('matchEvent', () => {
  it('matches the posting link in the canonical form capture stores', () => {
    const job = makeJob({
      id: 'a',
      ...applied,
      source: {
        url: 'https://linkedin.com/jobs/view/4123456789',
        originalUrl: 'https://www.linkedin.com/jobs/view/4123456789/',
        siteId: 'linkedin',
        siteName: 'LinkedIn',
        capturedAt: '2026-09-20T00:00:00.000Z',
      },
    });
    const other = makeJob({ id: 'b', ...applied });
    const e = event({
      postingUrls: ['https://linkedin.com/comm/jobs/view/4123456789?trackingId=x'],
    });
    expect(matchEvent(e, 'rejected', [other, job], stages)).toMatchObject({
      jobId: 'a',
      outcome: 'matched',
    });
  });

  it('matches a recruiting-system job id against externalId', () => {
    const job = makeJob({
      id: 'a',
      ...applied,
      externalId: 'R-04512',
      company: 'Harbourline Logistics',
    });
    const e = event({
      atsJobId: 'r-04512',
      ats: 'workday',
      sender: { address: 'x@myworkday.com', domain: 'myworkday.com' },
    });
    expect(matchEvent(e, 'interview', [job], stages).jobId).toBe('a');
  });

  it('uses the company name, sender domain and title, and needs a clear margin', () => {
    const analyst = makeJob({
      id: 'analyst',
      ...applied,
      company: 'Northwind Labs Pty Ltd',
      title: 'Data Analyst',
    });
    const engineer = makeJob({
      id: 'engineer',
      ...applied,
      company: 'Northwind Labs',
      title: 'Sr Data Engineer',
    });
    const unrelated = makeJob({
      id: 'other',
      ...applied,
      company: 'Quokka Health',
      title: 'Data Analyst',
    });
    const jobs = [analyst, engineer, unrelated];

    // Company alone can't choose between two Northwind jobs.
    expect(
      matchEvent(event({ companyHint: 'Northwind Labs' }), 'rejected', jobs, stages).outcome,
    ).toBe('ambiguous');
    // The title breaks the tie (abbreviations expanded).
    expect(
      matchEvent(
        event({ companyHint: 'Northwind Labs', titleHint: 'Senior Data Engineer' }),
        'rejected',
        jobs,
        stages,
      ).jobId,
    ).toBe('engineer');
    // Nothing points anywhere.
    expect(
      matchEvent(
        event({ sender: { address: 'x@gmail.com', domain: 'gmail.com' }, subject: 'Hi' }),
        'rejected',
        jobs,
        stages,
      ).outcome,
    ).toBe('none');
  });

  it("matches the company's own domain from the posting", () => {
    const job = makeJob({
      id: 'a',
      ...applied,
      company: 'Saltbush',
      source: {
        url: 'https://careers.saltbush-energy.example/jobs/12',
        originalUrl: 'https://careers.saltbush-energy.example/jobs/12',
        siteId: 'generic',
        siteName: 'Saltbush',
        capturedAt: '2026-09-20T00:00:00.000Z',
      },
    });
    const e = event({
      sender: {
        address: 'hr@mail.saltbush-energy.example',
        domain: 'mail.saltbush-energy.example',
      },
    });
    expect(matchEvent(e, 'rejected', [job], stages).candidates[0]?.reasons).toContain(
      'company domain',
    );
  });

  it('only matches applied, active, recent jobs, except that receipts may match saved jobs', () => {
    const saved = makeJob({ id: 'saved', company: 'Northwind Labs' });
    const archived = makeJob({
      id: 'arch',
      ...applied,
      company: 'Northwind Labs',
      archivedAt: '2026-09-30T00:00:00.000Z',
    });
    const rejected = makeJob({ id: 'rej', stageId: 'rejected', company: 'Northwind Labs' });
    const old = makeJob({
      id: 'old',
      ...applied,
      appliedAt: '2024-01-01T00:00:00.000Z',
      company: 'Northwind Labs',
    });
    const jobs = [saved, archived, rejected, old];
    const e = event({ companyHint: 'Northwind Labs' });
    expect(matchEvent(e, 'rejected', jobs, stages).outcome).toBe('none');
    expect(matchEvent(e, 'received', jobs, stages).jobId).toBe('saved');
  });

  it('follows threads and taught senders', () => {
    const job = makeJob({ id: 'a', ...applied, company: 'Zed' });
    const e = event({ thread: { inReplyTo: '<m1>', references: ['<m0>'] } });
    expect(matchEvent(e, 'interview', [job], stages, { threads: { '<m0>': 'a' } }).outcome).toBe(
      'thread',
    );
    expect(matchEvent(e, 'interview', [job], stages, { threads: { '<m0>': 'gone' } }).outcome).toBe(
      'none',
    );
    expect(
      matchEvent(event(), 'interview', [job], stages, {
        senders: { 'jobs@northwindlabs.example': 'a' },
      }).jobId,
    ).toBe('a');
  });

  it('matches end to end from an analysed email', () => {
    const job = makeJob({
      id: 'gh',
      ...applied,
      company: 'Northwind Labs',
      title: 'Data Analyst',
      externalId: '4012345',
      source: {
        url: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345',
        originalUrl: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345',
        siteId: 'greenhouse',
        siteName: 'Greenhouse',
        capturedAt: '2026-09-20T00:00:00.000Z',
      },
    });
    const analysed = analyzeEmail({
      from: 'Northwind Labs <no-reply@us.greenhouse-mail.io>',
      subject: 'Your application to Northwind Labs',
      date: '2026-10-01T00:00:00Z',
      html: '<p>Unfortunately, we will not be moving forward. <a href="https://job-boards.greenhouse.io/northwindlabs/jobs/4012345">Posting</a></p>',
    });
    expect(
      matchEvent(analysed, 'rejected', [job, makeJob({ id: 'x', ...applied })], stages).jobId,
    ).toBe('gh');
  });
});

describe('helpers', () => {
  it('normalises company names', () => {
    expect(normalizeCompany('Wattle & Co Pty. Ltd.')).toBe('wattle and');
    expect(normalizeCompany('Café Group Holdings Inc')).toBe('cafe');
  });

  it('expands title abbreviations', () => {
    expect([...titleTokens('Sr. SWE (Front-End)')]).toEqual([
      'senior',
      'software',
      'engineer',
      'frontend',
    ]);
  });

  it('finds the registrable domain', () => {
    expect(siteDomain('mail.careers.acme.com.au')).toBe('acme.com.au');
    expect(siteDomain('www.acme.example')).toBe('acme.example');
  });

  it('canonicalises posting links like capture does', () => {
    expect(
      canonicalPostingUrl('https://jobs.lever.co/acme/8a1f2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d/apply'),
    ).toBe('https://jobs.lever.co/acme/8a1f2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d');
    expect(canonicalPostingUrl('https://www.acme.example/jobs/1?utm_source=x')).toBe(
      'https://acme.example/jobs/1',
    );
    expect(canonicalPostingUrl('nope')).toBe('nope');
  });
});

describe('targetStage', () => {
  const at = (stageId: string) => makeJob({ stageId });

  it.each([
    ['received', 'saved', 'applied'],
    ['received', 'applied', undefined],
    ['received', 'interviewing', undefined],
    ['assessment', 'saved', 'applied'],
    ['assessment', 'applied', undefined],
    ['assessment', 'interviewing', undefined],
    ['interview', 'applied', 'interviewing'],
    ['interview', 'interviewing', undefined],
    ['offer', 'interviewing', 'offer'],
    ['offer', 'offer', undefined],
    ['rejected', 'interviewing', 'rejected'],
    ['rejected', 'rejected', undefined],
    ['rejected', 'offer', undefined],
  ] as const)('%s from %s → %s', (intent, from, to) => {
    expect(targetStage(intent, at(from), stages)).toBe(to);
  });

  it('works with custom columns', () => {
    const custom: Stage[] = [
      { id: 'todo', name: 'To apply', color: 'slate', kind: 'active', marksApplied: false },
      { id: 'sent', name: 'Sent', color: 'sky', kind: 'active', marksApplied: true },
      { id: 'tests', name: 'Tests', color: 'violet', kind: 'active', marksApplied: true },
      { id: 'talks', name: 'Interviews', color: 'amber', kind: 'active', marksApplied: true },
      { id: 'yes', name: 'Hired', color: 'emerald', kind: 'won', marksApplied: true },
      { id: 'gone', name: 'Withdrew', color: 'zinc', kind: 'lost', marksApplied: false },
      { id: 'no', name: 'No', color: 'rose', kind: 'lost', marksApplied: false },
    ];
    expect(targetStage('received', at('todo'), custom)).toBe('sent');
    expect(targetStage('assessment', at('sent'), custom)).toBe('tests');
    expect(targetStage('interview', at('sent'), custom)).toBe('talks');
    expect(targetStage('offer', at('talks'), custom)).toBe('yes');
    expect(targetStage('rejected', at('talks'), custom)).toBe('no');
    expect(targetStage('interview', at('missing'), custom)).toBeUndefined();
  });
});
