import type { FillReport } from '@/autofill';
import { allows } from '@/domain/plan';
import { basicProfile, hasProfile, type Profile } from '@/domain/profile';
import type { ProfileRepository } from '@/storage/profile-repository';
import type { PlanProvider } from './job-service';
import type { AutofillRunner } from './ports';

/**
 * Application autofill (ADR-0020): the profile on this device, and filling
 * the form in the current tab from it. Free fills the basic fields; Pro and
 * up fill everything. Builds without accounts
 * aren't limited (there's no way to upgrade), like other plan gates.
 */

export type AutofillBlock = 'plan' | 'no_profile';

/** One run over every frame, merged. */
export interface AutofillOutcome {
  filled: FillReport['filled'];
  skipped: FillReport['skipped'];
  files: string[];
  ats?: FillReport['ats'];
  /** Filled with the basic fields only (Free): Pro would also fill the rest. */
  basic: boolean;
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

  /** Pro and up (or a build without accounts): every field, saved answers, résumé import. */
  async allowed(): Promise<boolean> {
    return !this.plans || allows(await this.plans.currentPlan(), 'fullAutofill');
  }

  /** The profile this plan fills with: everything, or the basic fields on Free. */
  private async usable(): Promise<{ profile: Profile; basic: boolean }> {
    const profile = await this.profiles.get();
    return (await this.allowed())
      ? { profile, basic: false }
      : { profile: basicProfile(profile), basic: true };
  }

  /** Why autofill can't run now, if it can't. Every plan can fill the basics. */
  async blocked(): Promise<AutofillBlock | undefined> {
    if (!hasProfile((await this.usable()).profile)) return 'no_profile';
    return undefined;
  }

  async fill(tabId: number): Promise<AutofillOutcome> {
    const { profile, basic } = await this.usable();
    if (!hasProfile(profile)) throw new AutofillBlockedError('no_profile');
    const reports = await this.runner.fill(tabId, profile);
    const outcome: AutofillOutcome = { filled: [], skipped: [], files: [], basic };
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
