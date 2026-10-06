/**
 * Storage key layout (documented in docs/reference/storage.md):
 *
 *   meta          { schemaVersion }
 *   settings      Settings
 *   job:<id>      Job           — one key per job so a move writes one record
 *   account:*     Session and cached entitlement (AccountService); never backed up
 *   reminders     What reminders were already sent (ReminderService); never backed up
 *   sync:*        Sync state and lease (SyncService), and when jobs were deleted
 *                 (JobRepository); never backed up
 *   email:*       Email updates state and lease (EmailUpdateService); never backed up
 *   profile       Autofill profile (ADR-0020); this device only: never synced or backed up
 *   prompts:*     Store-rating prompt state (ADR-0024); this device only, never backed up
 *   mailbox:*     A connected Gmail or Outlook mailbox and its tokens (ADR-0032); never backed up
 *   widget:*      The widget's position, all-sites choice and hidden sites (ADR-0030, ADR-0033)
 *   tips:*        Dismissed one-time tips
 */
export const META_KEY = 'meta';
export const SETTINGS_KEY = 'settings';
export const JOB_KEY_PREFIX = 'job:';

export const jobKey = (id: string): string => `${JOB_KEY_PREFIX}${id}`;
export const isJobKey = (key: string): boolean => key.startsWith(JOB_KEY_PREFIX);

export const ACCOUNT_SESSION_KEY = 'account:session';
export const ACCOUNT_ENTITLEMENT_KEY = 'account:entitlement';
/** Display name and picture, cached for showing offline (ADR-0022). */
export const ACCOUNT_PROFILE_KEY = 'account:profile';
/** An opt-out of shared learning chosen at sign-in, until the server has it. */
export const ACCOUNT_SHARING_OPT_OUT_KEY = 'account:sharing-opt-out';
/** Plan prices in this user's currency, cached for a day. */
export const ACCOUNT_PRICES_KEY = 'account:prices';
/** The welcome email was requested for this account (ADR-0024); the server sends it once. */
export const ACCOUNT_WELCOMED_KEY = 'account:welcomed';
/** "Skip" on the one-time "What's your name?" question; userId it applies to. */
export const ACCOUNT_NAME_SKIPPED_KEY = 'account:name-skipped';

export const REMINDERS_KEY = 'reminders';

/** Sync bookkeeping (ADR-0016); never backed up. */
export const SYNC_STATE_KEY = 'sync:state';
export const SYNC_LOCK_KEY = 'sync:lock';
/** jobId → when it was deleted here, so its tombstone carries that time. */
export const SYNC_DELETIONS_KEY = 'sync:deletions';

/** Email updates bookkeeping (ADR-0014); never backed up. */
export const EMAIL_STATE_KEY = 'email:state';
export const EMAIL_LOCK_KEY = 'email:lock';

/** Store-rating prompt state (ADR-0024); this device only, never backed up. */
export const RATING_PROMPT_KEY = 'prompts:rating';

/** The autofill profile (ADR-0020): this device only, never synced or backed up. */
export const PROFILE_KEY = 'profile';
/** A connected Gmail or Outlook mailbox (ADR-0032): which one, and how far it has been read. */
export const MAILBOX_STATE_KEY = 'mailbox:state';
/** Its access tokens. Never synced, exported or sent anywhere but the provider. */
export const MAILBOX_AUTH_KEY = 'mailbox:auth';
