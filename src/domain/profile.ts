import { z } from 'zod';

/**
 * The applicant profile used by application autofill (ADR-0020): the basic
 * fields on every plan, everything on Pro and up.
 * Stored only on this device (`profile` key): never synced, never sent.
 * Every field is optional, so a half-filled profile still helps.
 */

const text = (max: number) => z.string().trim().max(max).optional();
const YesNo = z.enum(['yes', 'no']);

export const SavedAnswerSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(5000),
});

export const ProfileSchema = z.object({
  firstName: text(100),
  lastName: text(100),
  preferredName: text(100),
  email: text(254),
  phone: text(40),
  addressLine1: text(200),
  city: text(100),
  region: text(100),
  postcode: text(20),
  country: text(100),
  linkedin: text(300),
  github: text(300),
  website: text(300),
  currentCompany: text(200),
  currentTitle: text(200),
  /** "Are you legally allowed to work here?" */
  workAuthorization: YesNo.optional(),
  /** "Will you need visa sponsorship?" */
  needsSponsorship: YesNo.optional(),
  salaryExpectation: text(100),
  noticePeriod: text(100),
  howHeard: text(100),
  /** Answers to questions that recur across applications, matched by wording. */
  answers: z.array(SavedAnswerSchema).max(30).default([]),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const EMPTY_PROFILE: Profile = { answers: [] };

/** The profile fields autofill can put into a form. */
export const PROFILE_TEXT_FIELDS = [
  'firstName',
  'lastName',
  'preferredName',
  'email',
  'phone',
  'addressLine1',
  'city',
  'region',
  'postcode',
  'country',
  'linkedin',
  'github',
  'website',
  'currentCompany',
  'currentTitle',
  'salaryExpectation',
  'noticePeriod',
  'howHeard',
] as const satisfies readonly (keyof Profile)[];

/**
 * What autofill uses on Free (ADR-0013, 2026-10-02 revision): who you are and
 * how to reach you. Pro adds your current role, work rights, salary, notice
 * period, saved answers and starting from a résumé.
 */
export const BASIC_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'preferredName',
  'email',
  'phone',
  'addressLine1',
  'city',
  'region',
  'postcode',
  'country',
  'linkedin',
  'github',
  'website',
] as const satisfies readonly (keyof Profile)[];

/** The profile cut to the basic fields (Free). */
export function basicProfile(profile: Profile): Profile {
  const out: Profile = { answers: [] };
  for (const key of BASIC_PROFILE_FIELDS) {
    const value = profile[key];
    if (value) out[key] = value;
  }
  return out;
}

/** Whether the profile has anything to fill with. */
export function hasProfile(profile: Profile): boolean {
  return (
    PROFILE_TEXT_FIELDS.some((k) => Boolean(profile[k])) ||
    profile.workAuthorization !== undefined ||
    profile.needsSponsorship !== undefined ||
    profile.answers.length > 0
  );
}
