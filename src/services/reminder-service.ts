import {
  closesIn,
  closingSoon,
  daysUntilClose,
  digestDue,
  dueFollowUps,
  EMPTY_REMINDER_STATE,
  localDay,
  pruneNotified,
  type ReminderState,
} from '@/domain/reminders';
import type { Job } from '@/domain/job';
import type { JobRepository } from '@/storage/job-repository';
import type { KeyValueStore } from '@/storage/key-value-store';
import { REMINDERS_KEY } from '@/storage/keys';
import type { SettingsRepository } from '@/storage/settings-repository';
import type { PlanProvider } from './job-service';
import type { Notifier } from './ports';

/** Above this many due follow-ups at once, send one summary instead of one each. */
const MAX_SEPARATE = 3;

/** Notification ids, so a click can open the right place. */
export const FOLLOW_UP_PREFIX = 'rolestash.followup:';
export const FOLLOW_UPS_ID = 'rolestash.followups';
export const CLOSING_ID = 'rolestash.closing';

export interface ReminderRun {
  followUps: number;
  closing: number;
}

const who = (job: Job) => (job.company ? `${job.title} at ${job.company}` : job.title);

/**
 * Sends follow-up reminders and the daily closing-soon digest (Pro;
 * ADR-0015). The background worker calls run() on a periodic alarm. Free
 * accounts get nothing; builds without accounts aren't limited.
 */
export class ReminderService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly settings: SettingsRepository,
    private readonly store: KeyValueStore,
    private readonly notifier: Notifier,
    private readonly plans?: PlanProvider,
  ) {}

  async run(now: Date = new Date()): Promise<ReminderRun> {
    const none = { followUps: 0, closing: 0 };
    if (this.plans && (await this.plans.currentPlan()) === 'free') return none;
    if (!(await this.notifier.granted())) return none;

    const [jobs, settings, stored] = await Promise.all([
      this.jobs.list(),
      this.settings.get(),
      this.store.get([REMINDERS_KEY]),
    ]);
    const state: ReminderState = pruneNotified(
      (stored[REMINDERS_KEY] as ReminderState | undefined) ?? EMPTY_REMINDER_STATE,
      jobs,
    );

    const due = dueFollowUps(jobs, state, now);
    if (due.length > MAX_SEPARATE) {
      await this.notifier.notify(
        FOLLOW_UPS_ID,
        `${String(due.length)} follow-ups are due`,
        due.map(who).join('\n'),
      );
    } else {
      for (const job of due)
        await this.notifier.notify(
          `${FOLLOW_UP_PREFIX}${job.id}`,
          `Time to follow up: ${job.title}`,
          job.company
            ? `${job.company}. Open the card to update it.`
            : 'Open the card to update it.',
        );
    }
    for (const job of due) if (job.followUpAt) state.notified[job.id] = job.followUpAt;

    let closing = 0;
    if (settings.closingAlerts !== false && digestDue(state, now)) {
      const soon = closingSoon(jobs, settings.stages, now);
      closing = soon.length;
      if (soon.length > 0) {
        await this.notifier.notify(
          CLOSING_ID,
          soon.length === 1
            ? `Closing ${closesIn(daysUntilClose(soon[0]?.closesAt ?? '', now))}: ${soon[0]?.title ?? ''}`
            : `${String(soon.length)} jobs close soon`,
          soon
            .map((j) => `${who(j)}, ${closesIn(daysUntilClose(j.closesAt ?? '', now))}`)
            .join('\n'),
        );
      }
      state.lastDigest = localDay(now);
    }

    await this.store.set({ [REMINDERS_KEY]: state });
    return { followUps: due.length, closing };
  }
}
