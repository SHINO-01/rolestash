import { browser } from 'wxt/browser';
import type { FillReport } from '@/autofill';
import type { Profile } from '@/domain/profile';
import type { AutofillRunner } from '@/services/ports';

/**
 * Fills the form in a tab (ADR-0020): injects the bundled filler
 * (src/entrypoints/autofill.ts), then calls it with the profile. Runs on the
 * `activeTab` grant from the user's click, like capture; frames the grant
 * doesn't cover (another site's embedded form) are skipped.
 */
const AUTOFILL_FILE = '/autofill.js';

type Fill = (profile: unknown) => Promise<FillReport>;

export class ScriptingAutofillRunner implements AutofillRunner {
  async fill(tabId: number, profile: Profile): Promise<FillReport[]> {
    let allFrames = true;
    try {
      await browser.scripting.executeScript({
        target: { tabId, allFrames },
        files: [AUTOFILL_FILE],
      });
    } catch {
      allFrames = false; // a cross-origin frame without access fails the whole call
      await browser.scripting.executeScript({ target: { tabId }, files: [AUTOFILL_FILE] });
    }
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames },
      func: (p: Profile) => {
        const fill = (globalThis as { __rolestashAutofill?: Fill }).__rolestashAutofill;
        return fill ? fill(p) : undefined;
      },
      args: [profile],
    });
    return results
      .map((r) => r.result)
      .filter((r): r is FillReport => r !== undefined && typeof r === 'object');
  }
}
