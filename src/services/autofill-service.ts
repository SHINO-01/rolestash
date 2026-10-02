import type { FillReport } from '@/autofill';
import { allows } from '@/domain/plan';
import { hasProfile, type Profile } from '@/domain/profile';
import type { ProfileRepository } from '@/storage/profile-repository';
import type { PlanProvider } from './job-service';
import type { AutofillRunner } from './ports';

/**
 * Application autofill (Pro and up; ADR-0020): the profile on this device, and
 * filling the form in the current tab from it. Builds without accounts
 * aren't limited (there's no way to upgrade), like other plan gates.
 */

export type AutofillBlock = 'plan' | 'no_profile';

/** One run over every frame, merged. */
export interface AutofillOutcome {
  filled: FillReport['filled'];
  skipped: FillReport['skipped'];
  files: string[];
  ats?: FillReport['ats'];
}

export class AutofillService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly runner: AutofillRunner,
    private readonly plans?: PlanProvider,
  ) {}

  profile(): Promise<Profile> {
    return this.profiles.get();
  }

  saveProfile(profile: Profile): Promise<Profile> {
    return this.profiles.save(profile);
  }

  async allowed(): Promise<boolean> {
    return !this.plans || allows(await this.plans.currentPlan(), 'autofill');
  }

  /** Why autofill can't run now, if it can't. */
  async blocked(): Promise<AutofillBlock | undefined> {
    if (!(await this.allowed())) return 'plan';
    if (!hasProfile(await this.profiles.get())) return 'no_profile';
    return undefined;
  }

  async fill(tabId: number): Promise<AutofillOutcome> {
    const block = await this.blocked();
    if (block) throw new AutofillBlockedError(block);
    const reports = await this.runner.fill(tabId, await this.profiles.get());
    const outcome: AutofillOutcome = { filled: [], skipped: [], files: [] };
    for (const report of reports) {
      outcome.filled.push(...report.filled);
      outcome.skipped.push(...report.skipped);
      outcome.files.push(...report.files);
      outcome.ats ??= report.ats;
    }
    return outcome;
  }
}

export class AutofillBlockedError extends Error {
  constructor(readonly reason: AutofillBlock) {
    super(reason === 'plan' ? 'Autofill is part of Pro.' : 'Add your details first.');
    this.name = 'AutofillBlockedError';
  }
}
