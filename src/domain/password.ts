/**
 * Password rules (ADR-0036). Passwords are optional; when someone sets one it
 * must be at least 12 characters (no composition rules, no expiry, per NIST
 * SP 800-63B) and not guessable: not a common or breached password, not built
 * from their email or "rolestash". Checked on the device with a bundled
 * estimator and word list (zxcvbn-ts), loaded only when needed; nothing is
 * sent anywhere.
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
/** zxcvbn's 0–4 scale: 3 is "safely unguessable" (about 10^8 guesses or more). */
const MIN_SCORE = 3;

export type PasswordProblem = 'short' | 'long' | 'personal' | 'guessable';

export type PasswordVerdict =
  { ok: true } | { ok: false; problem: PasswordProblem; message: string };

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  short: `Use at least ${String(PASSWORD_MIN)} characters. A few unrelated words work well.`,
  long: `Use at most ${String(PASSWORD_MAX)} characters.`,
  personal: 'Leave out your email address and “Rolestash”.',
  guessable:
    'That one is easy to guess, or common in leaked password lists. Try a few unrelated words.',
};

const fail = (problem: PasswordProblem): PasswordVerdict => ({
  ok: false,
  problem,
  message: PASSWORD_MESSAGES[problem],
});

type Checker = (password: string, inputs: string[]) => number;
let checker: Promise<Checker> | undefined;

/** The estimator with the common-password list, loaded once on first use. */
function loadChecker(): Promise<Checker> {
  checker ??= Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common')]).then(
    ([core, common]) => {
      const zxcvbn = new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary },
        graphs: common.adjacencyGraphs,
      });
      return (password, inputs) => zxcvbn.check(password, inputs).score;
    },
  );
  return checker;
}

/** The parts of an email worth refusing in a password ("dana.smith" → dana, smith). */
function personalWords(email: string | undefined): string[] {
  const local = (email ?? '').toLowerCase().split('@')[0] ?? '';
  return [local, ...local.split(/[^a-z0-9]+/)].filter((w) => w.length >= 4);
}

/** Checks a new password; `email` is the account's, so the password can't be built from it. */
export async function checkPassword(password: string, email?: string): Promise<PasswordVerdict> {
  if (password.length < PASSWORD_MIN) return fail('short');
  if (password.length > PASSWORD_MAX) return fail('long');
  const lower = password.toLowerCase();
  const words = personalWords(email);
  if (lower.includes('rolestash') || words.some((w) => lower.includes(w))) return fail('personal');
  const score = (await loadChecker())(password, ['rolestash', 'role', 'stash', ...words]);
  return score >= MIN_SCORE ? { ok: true } : fail('guessable');
}
