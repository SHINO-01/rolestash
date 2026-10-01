import { z } from 'zod';

/**
 * The applicant profile used by application autofill (Advanced; ADR-0020).
 * Stored only on this device (`profile` key): never synced, never sent.
 * Every field is optional, so a half-filled profile still helps.
 */

const text = (max: number) => z.string().trim().max(max).optional();
const YesNo = z.enum(['yes', 'no']);

export const SavedAnswerSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(5000),
});
export type SavedAnswer = z.infer<typeof SavedAnswerSchema>;

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

/** Whether the profile has anything to fill with. */
export function hasProfile(profile: Profile): boolean {
  return (
    PROFILE_TEXT_FIELDS.some((k) => Boolean(profile[k])) ||
    profile.workAuthorization !== undefined ||
    profile.needsSponsorship !== undefined ||
    profile.answers.length > 0
  );
}
