import { boardEvents, calendarFile, interviewEvent } from '@/domain/calendar';
import { JobSchema, type Job } from '@/domain/job';
import { updateJob } from '@/domain/job-factory';
import { DEFAULT_STAGES } from '@/domain/stage';
import { jobsToCsv } from '@/storage/csv-export';
import { makeJob, testContext } from '../helpers/factories';

const contact = {
  id: 'c1',
  name: 'Jordan Lee',
  role: 'Recruiter',
  email: 'jordan@bluegum.example',
  notes: 'Prefers calls',
};
const round = {
  id: 'r1',
  kind: 'video' as const,
  at: '2026-10-08T23:00:00.000Z',
  with: 'Priya, Alex',
  notes: 'Asked about SQL',
};
const doc = {
  id: 'd1',
  kind: 'resume' as const,
  name: 'Resume-2026-v3.pdf',
  url: 'https://drive.example/resume',
};

describe('contacts, interview rounds and documents', () => {
  it('are optional job fields that validate', () => {
    const job = makeJob({ contacts: [contact], rounds: [round], documents: [doc] });
    expect(JobSchema.parse(job)).toEqual(job);
    expect(JobSchema.safeParse({ ...job, contacts: [{ id: 'x', name: '' }] }).success).toBe(false);
    expect(JobSchema.safeParse({ ...job, rounds: [{ id: 'x', kind: 'chat' }] }).success).toBe(
      false,
    );
    expect(
      JobSchema.safeParse({
        ...job,
        documents: [{ id: 'x', kind: 'resume', name: 'a', url: 'not a url' }],
      }).success,
    ).toBe(false);
    expect(
      JobSchema.safeParse({
        ...job,
        contacts: Array.from({ length: 31 }, (_, i) => ({ id: String(i), name: 'n' })),
      }).success,
    ).toBe(false);
  });

  it('are edits on the timeline', () => {
    const next = updateJob(makeJob(), { contacts: [contact] }, testContext());
    expect(next.contacts).toEqual([contact]);
    expect(next.activity.at(-1)).toMatchObject({ type: 'edited', fields: ['contacts'] });
  });

  it('show in the CSV export', () => {
    const csv = jobsToCsv(
      [makeJob({ contacts: [contact], rounds: [round], documents: [doc] })],
      DEFAULT_STAGES,
    );
    expect(csv).toContain('Contacts,Interview rounds,Documents');
    expect(csv).toContain('"Jordan Lee, Recruiter, jordan@bluegum.example"');
    expect(csv).toContain('Resume-2026-v3.pdf');
  });
});

describe('calendar export', () => {
  const now = new Date('2026-10-02T00:00:00.000Z');
  const jobs: Job[] = [
    makeJob({
      id: 'a',
      title: 'Data Analyst',
      company: 'Bluegum',
      rounds: [round, { id: 'r2', kind: 'final' }],
      followUpAt: '2026-10-10T22:00:00.000Z',
      closesAt: '2026-10-20',
      appliedAt: '2026-09-20T00:00:00.000Z',
      interview: {
        start: '2026-10-09T00:00:00.000Z',
        floating: false,
        meetingUrl: 'https://zoom.us/j/1',
      },
      contacts: [contact],
    }),
    makeJob({ id: 'b', title: 'Engineer', company: '', closesAt: '2026-10-15' }),
    makeJob({
      id: 'z',
      title: 'Archived',
      followUpAt: '2026-10-10T00:00:00.000Z',
      archivedAt: '2026-10-01T00:00:00.000Z',
    }),
  ];

  it('collects interviews, rounds, follow-ups and closing dates (until applied)', () => {
    expect(boardEvents(jobs).map((e) => e.uid)).toEqual([
      'a-interview',
      'a-round-r1',
      'a-followup',
      'b-closes',
    ]);
  });

  it('writes a calendar with stable UIDs, and no notes or contacts', () => {
    const ics = calendarFile(boardEvents(jobs), now);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:a-round-r1@rolestash.com\r\n');
    expect(ics).toContain('SUMMARY:Video interview: Data Analyst at Bluegum\r\n');
    expect(ics).toContain('DESCRIPTION:With Priya\\, Alex\\nAdded from Rolestash\r\n');
    expect(ics).toContain('DTSTART:20261010T220000Z\r\nDTEND:20261010T221500Z\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261015\r\nDTEND;VALUE=DATE:20261016\r\n');
    expect(ics).toContain('SUMMARY:Applications close: Engineer\r\n');
    expect(ics).toContain('URL:https://zoom.us/j/1');
    expect(ics).not.toMatch(/SQL|Prefers calls|jordan@/);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('has no event for an interview without a time', () => {
    expect(
      interviewEvent(
        makeJob({ interview: { floating: true, schedulingUrl: 'https://calendly.com/x' } }),
      ),
    ).toBeUndefined();
  });

  it('handles an all-day event at the end of a month', () => {
    expect(calendarFile([{ uid: 'x', summary: 's', date: '2026-10-31' }], now)).toContain(
      'DTEND;VALUE=DATE:20261101',
    );
  });
});
