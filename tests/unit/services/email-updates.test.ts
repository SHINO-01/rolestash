import type { Job } from '@/domain/job';
import type { Plan } from '@/domain/plan';
import { analyzeEmail, type EmailEvent } from '@/email';
import {
  BackendError,
  type EmailEventRow,
  type InboxInfo,
  type KnowledgeVote,
} from '@/services/backend/supabase-client';
import { EmailUpdateService } from '@/services/email-update-service';
import { JobService } from '@/services/job-service';
import type { EmailInbox } from '@/services/ports';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { EMAIL_LOCK_KEY } from '@/storage/keys';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob, testContext } from '../helpers/factories';

/** Mirrors email_events + my_inbox from supabase/migrations/…_email_updates.sql. */
class FakeInbox implements EmailInbox {
  rows: EmailEventRow[] = [];
  nextId = 1;
  token = 'k3x9q2w7m4p8r5t6abcd';
  fail?: BackendError;
  votes: KnowledgeVote[] = [];
  sharing = true;
  failVotes = false;

  add(event: unknown): void {
    this.rows.push({ id: this.nextId++, event });
  }
  address(rotate = false): Promise<InboxInfo> {
    if (rotate) this.token = 'newtokennewtokennewt';
    return Promise.resolve({
      ok: true,
      address: `${this.token}@in.rolestash.com`,
      shareLearning: this.sharing,
    });
  }
  events(after: number, limit: number): Promise<EmailEventRow[]> {
    if (this.fail) return Promise.reject(this.fail);
    return Promise.resolve(this.rows.filter((r) => r.id > after).slice(0, limit));
  }
  remove(ids: readonly number[]): Promise<void> {
    this.rows = this.rows.filter((r) => !ids.includes(r.id));
    return Promise.resolve();
  }
  vote(votes: readonly KnowledgeVote[]): Promise<void> {
    if (this.failVotes) return Promise.reject(new BackendError('network'));
    this.votes.push(...votes);
    return Promise.resolve();
  }
  setSharing(on: boolean): Promise<void> {
    this.sharing = on;
    if (!on) this.votes = [];
    return Promise.resolve();
  }
}

async function setup(plan: Plan = 'pro', trial = false) {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const ctx = testContext('2026-10-01T00:00:00.000Z');
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  const jobService = new JobService(jobs, settings, ctx);
  const inbox = new FakeInbox();
  const service = new EmailUpdateService(
    store,
    jobs,
    settings,
    jobService,
    inbox,
    { currentPlan: () => Promise.resolve(plan), onTrial: () => Promise.resolve(trial) },
    ctx,
  );
  return { store, jobs, jobService, inbox, service };
}

const applied = { stageId: 'applied', appliedAt: '2026-09-20T00:00:00.000Z' };

function northwind(overrides: Partial<Job> = {}): Job {
  return makeJob({
    id: 'nw',
    ...applied,
    title: 'Data Analyst',
    company: 'Northwind Labs',
    externalId: '4012345',
    source: {
      url: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345',
      originalUrl: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345',
      siteId: 'greenhouse',
      siteName: 'Greenhouse',
      capturedAt: '2026-09-20T00:00:00.000Z',
    },
    ...overrides,
  });
}

const rejection = (messageId = '<rej-1@gh>'): EmailEvent =>
  analyzeEmail({
    from: 'Northwind Labs <no-reply@us.greenhouse-mail.io>',
    subject: 'Your application to Northwind Labs',
    date: '2026-10-01T00:00:00Z',
    messageId,
    html: '<p>Unfortunately, we will not be moving forward with your application.</p><a href="https://job-boards.greenhouse.io/northwindlabs/jobs/4012345">Posting</a>',
  });

const invite = (overrides: { messageId?: string; inReplyTo?: string } = {}): EmailEvent =>
  analyzeEmail({
    from: 'Jordan Lee <jordan@northwindlabs.example>',
    subject: 'Interview invitation - Data Analyst',
    date: '2026-10-01T16:05:00+10:00',
    text: 'Hi Sam, we would like to invite you to a video interview on Thursday 9 October at 10am AEST. Zoom: https://us02web.zoom.us/j/81234567890',
    ...overrides,
  });

describe('EmailUpdateService', () => {
  it('applies a confident update, records it, and deletes the event from the server', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    inbox.add(rejection());
    expect(await service.run()).toEqual({ applied: 1, suggested: 0, unsorted: 0 });

    const job = await jobs.get('nw');
    expect(job?.stageId).toBe('rejected');
    expect(job?.activity.at(-1)).toMatchObject({
      type: 'email_update',
      fromStageId: 'applied',
      toStageId: 'rejected',
      email: {
        intent: 'rejected',
        subject: 'Your application to Northwind Labs',
        sender: 'Northwind Labs <no-reply@us.greenhouse-mail.io>',
      },
    });
    expect(inbox.rows).toHaveLength(0);
    expect((await service.state()).threads).toEqual({ '<rej-1@gh>': 'nw' });
  });

  it('remembers when forwarding last worked, and the guided-setup progress', async () => {
    const { inbox, service } = await setup();
    expect((await service.state()).lastEmailAt).toBeUndefined();
    // An email nobody matched still proves forwarding works.
    inbox.add({ ...rejection(), action: 'none', intent: 'other' });
    await service.run();
    expect((await service.state()).lastEmailAt).toBe(rejection().receivedAt);

    await service.setSetup({ provider: 'gmail', done: ['forward', 'forward', 'filter'] });
    expect((await service.state()).setup).toEqual({
      provider: 'gmail',
      done: ['forward', 'filter'],
    });
  });

  it('adds an interview with its time and Join link', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    inbox.add(invite());
    await service.run();
    const job = await jobs.get('nw');
    expect(job?.stageId).toBe('interviewing');
    expect(job?.interview).toEqual({
      start: '2026-10-08T23:00:00.000Z',
      floating: false,
      timeZone: 'Australia/Sydney',
      meetingUrl: 'https://us02web.zoom.us/j/81234567890',
    });
  });

  it('leaves a suggestion for less confident updates, which can be accepted or dismissed', async () => {
    const { jobs, jobService, inbox, service } = await setup();
    await jobs.save(northwind());
    inbox.add({ ...rejection(), action: 'suggest' });
    expect(await service.run()).toMatchObject({ suggested: 1 });
    expect((await jobs.get('nw'))?.suggestion).toMatchObject({
      toStageId: 'rejected',
      email: { intent: 'rejected' },
    });
    expect((await jobs.get('nw'))?.stageId).toBe('applied');

    const accepted = await jobService.acceptSuggestion('nw');
    expect(accepted).toMatchObject({ stageId: 'rejected' });
    expect(accepted.suggestion).toBeUndefined();

    inbox.add({ ...rejection('<rej-2@gh>'), action: 'suggest' });
    await jobs.save({ ...accepted, stageId: 'applied' });
    await service.run();
    const dismissed = await jobService.dismissSuggestion('nw');
    expect(dismissed.suggestion).toBeUndefined();
    expect(dismissed.stageId).toBe('applied');
  });

  it('files unmatched updates as unsorted; assigning teaches the sender and applies it', async () => {
    const { jobs, inbox, service } = await setup();
    const other = makeJob({ id: 'q', ...applied, title: 'Designer', company: 'Quokka Health' });
    await jobs.save(other);
    inbox.add(invite());
    expect(await service.run()).toMatchObject({ unsorted: 1 });
    const [item] = (await service.state()).unsorted;
    expect(item).toMatchObject({
      intent: 'interview',
      subject: 'Interview invitation - Data Analyst',
      sender: { address: 'jordan@northwindlabs.example', name: 'Jordan Lee' },
    });

    const job = await service.assign(item!.id, 'q');
    expect(job).toMatchObject({
      stageId: 'interviewing',
      interview: { start: '2026-10-08T23:00:00.000Z' },
    });
    const state = await service.state();
    expect(state.unsorted).toEqual([]);
    expect(state.senders).toEqual({ 'jordan@northwindlabs.example': 'q' });

    // The next email from that sender follows on its own.
    inbox.add({
      ...rejection('<x>'),
      sender: { address: 'jordan@northwindlabs.example', domain: 'northwindlabs.example' },
      postingUrls: [],
      companyHint: undefined,
      atsJobId: undefined,
    });
    await service.run();
    expect((await jobs.get('q'))?.stageId).toBe('rejected');
  });

  it('follows threads: a reply goes to the job its thread matched', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    await jobs.save(
      northwind({
        id: 'nw2',
        title: 'Data Engineer',
        externalId: '999',
        source: {
          ...northwind().source,
          url: 'https://job-boards.greenhouse.io/northwindlabs/jobs/999',
        },
      }),
    );
    inbox.add(invite({ messageId: '<m1>' }));
    await service.run();
    // Ambiguous (two Northwind jobs) and no posting link: unsorted.
    const [item] = (await service.state()).unsorted;
    await service.assign(item!.id, 'nw2');
    inbox.add(
      analyzeEmail({
        from: 'Jordan <jordan@northwindlabs.example>',
        subject: 'Re: Interview',
        date: '2026-10-02T00:00:00Z',
        inReplyTo: '<m1>',
        text: 'Unfortunately we have decided not to proceed with your application.',
      }),
    );
    await service.run();
    expect((await jobs.get('nw2'))?.stageId).toBe('rejected');
    expect((await jobs.get('nw'))?.stageId).toBe('applied');
  });

  it('adds a job from an unsorted update', async () => {
    const { jobs, inbox, service } = await setup();
    inbox.add(rejection());
    await service.run();
    const [item] = (await service.state()).unsorted;
    const job = await service.addJob(item!.id);
    expect(job).toMatchObject({ company: 'Northwind Labs', stageId: 'rejected' });
    expect(job.source.url).toBe('https://job-boards.greenhouse.io/northwindlabs/jobs/4012345');
    expect(await jobs.list()).toHaveLength(1);
    await expect(service.addJob('gone')).rejects.toThrow();
    await expect(service.assign('gone', job.id)).rejects.toThrow();
  });

  it('keeps the Gmail confirmation code for a week', async () => {
    const { inbox, service } = await setup();
    inbox.add(
      analyzeEmail({
        from: 'forwarding-noreply@google.com',
        subject: '(#123456789) Gmail Forwarding Confirmation',
        date: '2026-09-30T23:00:00Z',
        text: 'Confirmation code: 123456789\nhttps://mail-settings.google.com/mail/vf-abc',
      }),
    );
    await service.run();
    expect(await service.verification()).toEqual({
      code: '123456789',
      url: 'https://mail-settings.google.com/mail/vf-abc',
      receivedAt: '2026-09-30T23:00:00.000Z',
    });
  });

  it('skips everything off Pro, when busy, and on malformed or "other" events', async () => {
    const free = await setup('free');
    free.inbox.add(rejection());
    expect(await free.service.run()).toMatchObject({ skipped: 'not_advanced' });
    expect(free.inbox.rows).toHaveLength(1);

    const { store, jobs, inbox, service } = await setup();
    await store.set({ [EMAIL_LOCK_KEY]: Date.parse('2026-10-01T00:00:30.000Z') });
    expect(await service.run()).toMatchObject({ skipped: 'busy' });
    await store.remove([EMAIL_LOCK_KEY]);

    await jobs.save(northwind());
    inbox.add({ nonsense: true });
    inbox.add({ ...rejection(), intent: 'other', action: 'none' });
    expect(await service.run()).toEqual({ applied: 0, suggested: 0, unsorted: 0 });
    expect(inbox.rows).toHaveLength(0);
    expect((await jobs.get('nw'))?.stageId).toBe('applied');
  });

  it('records problems and rethrows', async () => {
    const { inbox, service } = await setup();
    inbox.fail = new BackendError('network');
    await expect(service.run()).rejects.toThrow();
    expect((await service.state()).problem).toBe('offline');
    inbox.fail = new BackendError('session_expired');
    await expect(service.run()).rejects.toThrow();
    expect((await service.state()).problem).toBe('signed_out');
    inbox.fail = undefined;
    await service.run();
    expect((await service.state()).problem).toBeUndefined();
  });

  it('gets and rotates the address', async () => {
    const { service } = await setup();
    expect(await service.address()).toEqual({
      ok: true,
      address: 'k3x9q2w7m4p8r5t6abcd@in.rolestash.com',
      shareLearning: true,
    });
    expect(await service.address(true)).toEqual({
      ok: true,
      address: 'newtokennewtokennewt@in.rolestash.com',
      shareLearning: true,
    });
    expect((await service.state()).address).toBe('newtokennewtokennewt@in.rolestash.com');
  });

  it('dismisses unsorted updates', async () => {
    const { inbox, service } = await setup();
    inbox.add(rejection());
    await service.run();
    const [item] = (await service.state()).unsorted;
    await service.dismissUnsorted(item!.id);
    expect((await service.state()).unsorted).toEqual([]);
  });
});

describe('JobService email updates', () => {
  it('undoes an email update back to the top of the old column', async () => {
    const { jobs, jobService } = await setup();
    await jobs.save(northwind());
    const moved = await jobService.applyEmailUpdate('nw', {
      toStageId: 'rejected',
      email: {
        intent: 'rejected',
        subject: 's',
        sender: 'x@y.example',
        receivedAt: '2026-10-01T00:00:00.000Z',
      },
    });
    const entry = moved.activity.at(-1)!;
    const undone = await jobService.undoEmailUpdate('nw', entry.id);
    expect(undone.stageId).toBe('applied');
    expect(await jobService.undoEmailUpdate('nw', entry.id)).toEqual(undone);
  });

  it('accepting a suggestion whose column was removed applies only the interview', async () => {
    const { jobs, jobService } = await setup();
    await jobs.save(northwind());
    const interview = { start: '2026-10-08T23:00:00.000Z', floating: false };
    await jobService.suggestEmailUpdate('nw', {
      toStageId: 'gone',
      interview,
      email: {
        intent: 'interview',
        subject: 's',
        sender: 'x',
        receivedAt: '2026-10-01T00:00:00.000Z',
      },
    });
    const accepted = await jobService.acceptSuggestion('nw');
    expect(accepted).toMatchObject({ stageId: 'applied', interview });
    expect(await jobService.acceptSuggestion('nw')).toEqual(accepted);
    expect(await jobService.dismissSuggestion('nw')).toEqual(accepted);
  });
});

describe('shared learning (ADR-0014 §6)', () => {
  const T = 'a'.repeat(64);
  // Vote tickets, as ingest_email_event issues them (ADR-0028).
  const TT = `20261001.${'1'.repeat(64)}`;
  const DT = `20261001.${'2'.repeat(64)}`;
  const tickets = { tickets: { template: TT, domain: DT } };

  it('accepting a suggestion confirms its template', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    inbox.add({ ...rejection(), action: 'suggest', template: T, ...tickets });
    await service.run();
    expect((await jobs.get('nw'))?.suggestion).toMatchObject({ template: T, templateTicket: TT });
    const job = await service.acceptSuggestion('nw');
    expect(job.stageId).toBe('rejected');
    expect(inbox.votes).toEqual([{ kind: 'template', key: T, value: 'rejected', ticket: TT }]);
  });

  it('votes only with the server’s ticket for that email', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    inbox.add({ ...rejection(), action: 'suggest', template: T });
    await service.run();
    await service.acceptSuggestion('nw');
    expect(inbox.votes).toEqual([]);
  });

  it('correcting a suggestion applies and teaches the right intent', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    inbox.add({ ...rejection(), action: 'suggest', template: T, ...tickets });
    await service.run();
    const job = await service.correctSuggestion('nw', 'interview');
    expect(job.stageId).toBe('interviewing');
    expect(job.suggestion).toBeUndefined();
    expect(job.activity.at(-1)).toMatchObject({
      type: 'email_update',
      email: { intent: 'interview' },
    });
    expect(inbox.votes).toEqual([{ kind: 'template', key: T, value: 'interview', ticket: TT }]);

    inbox.add({ ...rejection('<r2>'), action: 'suggest', template: T, ...tickets });
    await jobs.save({ ...job, stageId: 'applied' });
    await service.run();
    const cleared = await service.correctSuggestion('nw', 'other');
    expect(cleared).toMatchObject({ stageId: 'applied' });
    expect(cleared.suggestion).toBeUndefined();
    expect(inbox.votes.at(-1)).toEqual({ kind: 'template', key: T, value: 'other', ticket: TT });
    await expect(service.correctSuggestion('nw', 'offer')).rejects.toThrow();
  });

  it('filing an unsorted update teaches the template and the sender domain’s company', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(
      makeJob({ id: 'q', ...applied, title: 'Designer', company: 'Quokka Health Pty Ltd' }),
    );
    inbox.add({ ...invite(), template: T, ...tickets });
    await service.run();
    const [item] = (await service.state()).unsorted;
    await service.assign(item!.id, 'q');
    expect(inbox.votes).toEqual([
      { kind: 'template', key: T, value: 'interview', ticket: TT },
      { kind: 'domain', key: 'northwindlabs.example', value: 'quokka health', ticket: DT },
    ]);
  });

  it('never votes a mail platform or recruiting system domain', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(makeJob({ id: 'q', ...applied, company: 'Quokka Health' }));
    inbox.add({
      ...rejection(),
      sender: { address: 'x@us.greenhouse-mail.io', domain: 'us.greenhouse-mail.io' },
      postingUrls: [],
      companyHint: undefined,
      ...tickets,
    });
    await service.run();
    const [item] = (await service.state()).unsorted;
    await service.assign(item!.id, 'q');
    expect(inbox.votes).toEqual([]);
  });

  it('stops voting when sharing is off, and a failed vote never gets in the way', async () => {
    const { jobs, inbox, service } = await setup();
    await jobs.save(northwind());
    await service.setSharing(false);
    expect((await service.state()).shareLearning).toBe(false);
    inbox.add({ ...rejection(), action: 'suggest', template: T, ...tickets });
    await service.run();
    await service.acceptSuggestion('nw');
    expect(inbox.votes).toEqual([]);

    await service.setSharing(true);
    inbox.failVotes = true;
    inbox.add({ ...rejection('<r3>'), action: 'suggest', template: T, ...tickets });
    await jobs.save({ ...(await jobs.get('nw'))!, stageId: 'applied' });
    await service.run();
    await expect(service.acceptSuggestion('nw')).resolves.toMatchObject({ stageId: 'rejected' });
  });

  it('does not vote during the trial', async () => {
    for (const [plan, trial] of [['pro', true]] as const) {
      const { jobs, jobService, inbox, service } = await setup(plan, trial);
      await jobs.save(northwind());
      await jobService.suggestEmailUpdate('nw', {
        toStageId: 'rejected',
        template: T,
        templateTicket: TT,
        email: {
          intent: 'rejected',
          subject: 's',
          sender: 'x',
          receivedAt: '2026-10-01T00:00:00.000Z',
        },
      });
      await service.acceptSuggestion('nw');
      expect(inbox.votes).toEqual([]);
    }
  });
});
