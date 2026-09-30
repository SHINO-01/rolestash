/**
 * Storage key layout (documented in docs/reference/storage.md):
 *
 *   meta          { schemaVersion }
 *   settings      Settings
 *   job:<id>      Job           — one key per job so a move writes one record
 *   account:*     Session and cached entitlement (AccountService); never backed up
 */
export const META_KEY = 'meta';
export const SETTINGS_KEY = 'settings';
export const JOB_KEY_PREFIX = 'job:';

export const jobKey = (id: string): string => `${JOB_KEY_PREFIX}${id}`;
export const isJobKey = (key: string): boolean => key.startsWith(JOB_KEY_PREFIX);

export const ACCOUNT_SESSION_KEY = 'account:session';
export const ACCOUNT_ENTITLEMENT_KEY = 'account:entitlement';
