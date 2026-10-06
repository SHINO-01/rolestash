import { SupabaseClient } from '@/services/backend/supabase-client';
import { FeedbackService } from '@/services/feedback-service';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { RATING_PROMPT_KEY } from '@/storage/keys';
import { fakeFetch } from '../helpers/fake-fetch';
import { makeJob, testContext } from '../helpers/factories';

const SB = 'https://ref.supabase.co';
const ABOUT = { version: '0.4.1', browser: 'Chrome on Linux' };

function setup(withBackend = true) {
  const ctx = testContext('2026-10-01T00:00:00.000Z');
  const store = new MemoryKeyValueStore();
  const jobs = new JobRepository(store);
  const f = fakeFetch({
    [`POST ${SB}/functions/v1/bug-report`]: { status: 200, body: { id: 12 } },
  });
  const client = withBackend
    ? new SupabaseClient({ url: SB, anonKey: 'anon' }, f.fetch, ctx.now)
    : undefined;
  const feedback = new FeedbackService(store, jobs, ctx, ABOUT, client);
  return { ctx, store, jobs, feedback, calls: f.calls };
}

describe('FeedbackService', () => {
  it('remembers the first visit and asks after a week of real use', async () => {
    const { ctx, jobs, feedback, store } = setup();
    expect(await feedback.shouldAskForRating()).toBe(false);
    expect((await store.get([RATING_PROMPT_KEY]))[RATING_PROMPT_KEY]).toMatchObject({
      firstSeenAt: '2026-10-01T00:00:00.000Z',
    });
    await jobs.saveMany(Array.from({ length: 10 }, (_, i) => makeJob({ id: `j${String(i)}` })));
    ctx.advance(7 * 24 * 3600_000);
    expect(await feedback.shouldAskForRating()).toBe(true);
    await feedback.answerRating('never');
    expect(await feedback.shouldAskForRating()).toBe(false);
  });

  it('sends a report with only the listed details, without an account', async () => {
    const { feedback, calls } = setup();
    const context = await feedback.reportContext('widget', 'https://jobs.example/1');
    expect(context).toEqual({
      version: '0.4.1',
      browser: 'Chrome on Linux',
      plan: 'free',
      where: 'widget',
      page: 'https://jobs.example/1',
    });
    expect(
      await feedback.report({ message: '  Salary missing ', contactEmail: ' ', context }),
    ).toBe(12);
    expect(calls[0]?.body).toEqual({ message: 'Salary missing', context });
    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('falls back to email when the build has no backend', async () => {
    const { feedback } = setup(false);
    expect(feedback.canSendReports).toBe(false);
    const context = await feedback.reportContext('board');
    await expect(feedback.report({ message: 'x', context })).rejects.toThrow(/email/);
  });
});
