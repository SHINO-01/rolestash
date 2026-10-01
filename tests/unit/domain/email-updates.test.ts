import { finishedAt } from '@/domain/history';
import {
  interviewCalendarFile,
  interviewStart,
  isPhysicalLocation,
  isUpcoming,
  mapsUrl,
} from '@/domain/interview';
import { EMAIL_UPDATE_INTENTS, JobSchema, type EmailNote } from '@/domain/job';
import {
  applyEmailUpdate,
  clearSuggestion,
  setSuggestion,
  undoEmailUpdate,
} from '@/domain/job-factory';
import { DEFAULT_STAGES } from '@/domain/stage';
import { STATUS_INTENTS } from '@/email';
import { makeJob, testContext } from '../helpers/factories';

const stage = (id: string) => DEFAULT_STAGES.find((s) => s.id === id)!;
const email: EmailNote = {
  intent: 'interview',
  subject: 'Interview invitation',
  sender: 'Jordan <jordan@bluegum.example>',
  receivedAt: '2026-10-01T06:00:00.000Z',
};
const interview = {
  start: '2026-10-08T23:00:00.000Z',
  floating: false,
  timeZone: 'Australia/Sydney',
  meetingUrl: 'https://zoom.us/j/1',
};

describe('email updates on a job', () => {
  it('uses the same intents as the email engine', () => {
    expect([...EMAIL_UPDATE_INTENTS]).toEqual([...STATUS_INTENTS]);
  });

  it('moves the job and sets the interview as one undoable entry', () => {
    const ctx = testContext();
    const job = makeJob({ stageId: 'saved' });
    const next = applyEmailUpdate(
      job,
      { to: { stage: stage('interviewing'), rank: 5 }, interview, email },
      ctx,
    );
    expect(next).toMatchObject({ stageId: 'interviewing', rank: 5, interview });
    expect(next.appliedAt).toBe('2026-09-28T00:00:00.000Z');
    expect(next.activity.at(-1)).toMatchObject({
      type: 'email_update',
      fromStageId: 'saved',
      toStageId: 'interviewing',
      setInterview: true,
      email,
    });
    expect(JobSchema.parse(next)).toEqual(next);
  });

  it('changes nothing when nothing is new, but clears a superseded suggestion', () => {
    const ctx = testContext();
    const job = makeJob({ stageId: 'interviewing', interview });
    expect(
      applyEmailUpdate(
        job,
        { to: { stage: stage('interviewing'), rank: 1 }, interview, email },
        ctx,
      ),
    ).toBe(job);
    const suggested = setSuggestion(
      job,
      { id: 's', createdAt: '2026-10-01T00:00:00.000Z', email },
      ctx,
    );
    expect(applyEmailUpdate(suggested, { interview, email }, ctx).suggestion).toBeUndefined();
  });

  it('updates the interview without moving', () => {
    const ctx = testContext();
    const job = makeJob({ stageId: 'interviewing', interview });
    const later = { ...interview, start: '2026-10-09T23:00:00.000Z' };
    const next = applyEmailUpdate(job, { interview: later, email }, ctx);
    expect(next.interview).toEqual(later);
    expect(next.activity.at(-1)).toMatchObject({ type: 'email_update', setInterview: true });
    expect(next.activity.at(-1)?.toStageId).toBeUndefined();
  });

  it('sets and clears suggestions', () => {
    const ctx = testContext();
    const job = makeJob();
    const suggested = setSuggestion(
      job,
      { id: 's', createdAt: '2026-10-01T00:00:00.000Z', toStageId: 'rejected', email },
      ctx,
    );
    expect(suggested.suggestion?.toStageId).toBe('rejected');
    expect(clearSuggestion(suggested, ctx).suggestion).toBeUndefined();
    expect(clearSuggestion(job, ctx)).toBe(job);
  });

  it('undoes a move and the interview it set, keeping the entry marked undone', () => {
    const ctx = testContext();
    const moved = applyEmailUpdate(
      makeJob({ stageId: 'applied' }),
      { to: { stage: stage('interviewing'), rank: 5 }, interview, email },
      ctx,
    );
    const entry = moved.activity.at(-1)!;
    const undone = undoEmailUpdate(moved, entry.id, { stage: stage('applied'), rank: 9 }, ctx);
    expect(undone).toMatchObject({ stageId: 'applied', rank: 9 });
    expect(undone.interview).toBeUndefined();
    expect(undone.activity.find((a) => a.id === entry.id)?.undone).toBe(true);
    expect(undone.activity.at(-1)).toMatchObject({ type: 'stage_changed', toStageId: 'applied' });
    // Twice is a no-op, as is an unknown entry.
    expect(undoEmailUpdate(undone, entry.id, undefined, ctx)).toBe(undone);
    expect(undoEmailUpdate(undone, 'nope', undefined, ctx)).toBe(undone);
  });

  it("doesn't move a job back when the user moved it since", () => {
    const ctx = testContext();
    const moved = applyEmailUpdate(
      makeJob({ stageId: 'applied' }),
      { to: { stage: stage('rejected'), rank: 5 }, email },
      ctx,
    );
    const entry = moved.activity.at(-1)!;
    const elsewhere = { ...moved, stageId: 'offer' };
    const undone = undoEmailUpdate(elsewhere, entry.id, { stage: stage('applied'), rank: 9 }, ctx);
    expect(undone.stageId).toBe('offer');
    expect(undone.activity.find((a) => a.id === entry.id)?.undone).toBe(true);
  });

  it('dates History by email moves too, unless undone', () => {
    const ctx = testContext('2026-10-01T00:00:00.000Z');
    const moved = applyEmailUpdate(
      makeJob({ stageId: 'applied' }),
      { to: { stage: stage('rejected'), rank: 5 }, email },
      ctx,
    );
    expect(finishedAt(moved)).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('interview helpers', () => {
  it('reads exact and floating starts', () => {
    expect(interviewStart({ ...interview })?.toISOString()).toBe('2026-10-08T23:00:00.000Z');
    const floating = interviewStart({ start: '2026-10-14T14:30:00', floating: true });
    expect([floating?.getHours(), floating?.getMinutes()]).toEqual([14, 30]);
    expect(interviewStart({ floating: true })).toBeUndefined();
    expect(interviewStart({ start: 'nope', floating: true })).toBeUndefined();
  });

  it('knows when an interview is upcoming', () => {
    const now = new Date('2026-10-09T00:00:00.000Z');
    expect(isUpcoming(interview, now)).toBe(true);
    expect(isUpcoming(interview, new Date('2026-10-09T04:00:00.000Z'))).toBe(false);
    expect(isUpcoming(undefined, now)).toBe(false);
  });

  it('links places to Google Maps, but not links or "online"', () => {
    expect(mapsUrl('22 Sample Rd, Newcastle NSW')).toBe(
      'https://www.google.com/maps/search/?api=1&query=22%20Sample%20Rd%2C%20Newcastle%20NSW',
    );
    expect(isPhysicalLocation('Level 4, 100 Example St')).toBe(true);
    expect(isPhysicalLocation('https://zoom.us/j/1')).toBe(false);
    expect(isPhysicalLocation('Microsoft Teams')).toBe(false);
    expect(isPhysicalLocation(undefined)).toBe(false);
  });

  it('writes an .ics file: UTC for exact times, floating as written', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const exact = interviewCalendarFile(
      makeJob({
        id: 'j1',
        title: 'Data Analyst',
        company: 'Bluegum, Inc',
        interview: { ...interview, location: 'Level 4; Room 2' },
      }),
      now,
    );
    expect(exact).toContain('DTSTART:20261008T230000Z\r\n');
    expect(exact).toContain('DTEND:20261009T000000Z\r\n');
    expect(exact).toContain('SUMMARY:Interview: Data Analyst at Bluegum\\, Inc\r\n');
    expect(exact).toContain('LOCATION:Level 4\\; Room 2\r\n');
    expect(exact).toContain('UID:j1-interview@rolestash.com');
    expect(exact).toContain('URL:https://zoom.us/j/1');

    const floating = interviewCalendarFile(
      makeJob({
        title: 'A very long job title that goes on and on to make the summary line fold over',
        company: '',
        interview: { start: '2026-10-14T14:30:00', end: '2026-10-14T15:00:00', floating: true },
      }),
      now,
    );
    expect(floating).toContain('DTSTART:20261014T143000\r\n');
    expect(floating).toContain('DTEND:20261014T150000\r\n');
    expect(floating).toMatch(/\r\n [^\r]/); // folded
    expect(interviewCalendarFile(makeJob({ interview: { floating: true } }), now)).toBeUndefined();
  });
});
