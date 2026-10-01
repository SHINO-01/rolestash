/**
 * Storage key layout (documented in docs/reference/storage.md):
 *
 *   meta          { schemaVersion }
 *   settings      Settings
 *   job:<id>      Job           — one key per job so a move writes one record
 *   account:*     Session and cached entitlement (AccountService); never backed up
 *   reminders     What reminders were already sent (ReminderService); never backed up
 *   sync:*        Sync state and lease (SyncService); never backed up
 *   email:*       Email updates state and lease (EmailUpdateService); never backed up
 *   profile       Autofill profile (ADR-0020); this device only: never synced or backed up
 */
export const META_KEY = 'meta';
export const SETTINGS_KEY = 'settings';
export const JOB_KEY_PREFIX = 'job:';

export const jobKey = (id: string): string => `${JOB_KEY_PREFIX}${id}`;
export const isJobKey = (key: string): boolean => key.startsWith(JOB_KEY_PREFIX);

export const ACCOUNT_SESSION_KEY = 'account:session';
export const ACCOUNT_ENTITLEMENT_KEY = 'account:entitlement';

export const REMINDERS_KEY = 'reminders';

/** Sync bookkeeping (ADR-0016); never backed up. */
export const SYNC_STATE_KEY = 'sync:state';
export const SYNC_LOCK_KEY = 'sync:lock';

/** Email updates bookkeeping (ADR-0014); never backed up. */
export const EMAIL_STATE_KEY = 'email:state';
export const EMAIL_LOCK_KEY = 'email:lock';

/** The autofill profile (ADR-0020): this device only, never synced or backed up. */
export const PROFILE_KEY = 'profile';
