import { fillForm } from '@/autofill';
import { ProfileSchema } from '@/domain/profile';

/**
 * Injected on demand into the tab (and its frames) when the user asks to
 * fill an application, via chrome.scripting.executeScript({ files }) — never
 * a persistent content script (ADR-0004, ADR-0020). It only defines the fill
 * function; the runner then calls it with the profile, so the profile goes
 * to this page alone and only on that click.
 */
export default defineUnlistedScript(() => {
  (globalThis as { __rolestashAutofill?: unknown }).__rolestashAutofill = (profile: unknown) =>
    fillForm(document, ProfileSchema.parse(profile));
});
