import type { Profile } from '../domain/profile';
import {
  type Ats,
  type FieldKey,
  type FormField,
  detectAts,
  normalizeLabel,
  ownAncestors,
  scanForm,
} from './fields';

/**
 * Fills an application form from the profile (ADR-0020). Rules:
 *  - only empty fields are filled: nothing the user typed is overwritten;
 *  - sensitive questions (demographics, identity numbers, secrets) and file
 *    uploads are never touched;
 *  - nothing is submitted: the user reviews and sends the form themselves.
 * The report is plain data, so it crosses executeScript (structured clone).
 */

export type SkipReason = 'sensitive' | 'no_value' | 'unknown' | 'filled_already' | 'no_option';

export interface FillReport {
  ats?: Ats;
  filled: { key: FieldKey | 'answer'; label: string }[];
  /** Questions left for the user, and why. */
  skipped: { label: string; reason: SkipReason; required: boolean }[];
  /** File inputs (résumé, cover letter) to attach by hand. */
  files: string[];
}

/** Profile fields as the text each form question wants. */
function valueFor(key: FieldKey, profile: Profile): string | undefined {
  switch (key) {
    case 'fullName':
      return [profile.firstName, profile.lastName].filter(Boolean).join(' ') || undefined;
    case 'location':
      return (
        [profile.city, profile.region, profile.country].filter(Boolean).join(', ') || undefined
      );
    case 'workAuthorization':
    case 'needsSponsorship':
      return profile[key];
    default:
      return profile[key];
  }
}

/**
 * A saved answer whose question shares most of its words with this one.
 * Capitalised words after the first (company and product names) don't
 * count, so "Why do you want to work at Northwind?" finds "Why do you want
 * to work here?".
 */
function savedAnswer(label: string, profile: Profile): string | undefined {
  const words = (s: string) =>
    new Set(
      s
        .split(/\s+/)
        .filter((w, i) => i === 0 || !/^[A-Z]/.test(w))
        .flatMap((w) => normalizeLabel(w).split(' '))
        .filter((w) => w.length > 2),
    );
  const asked = words(label);
  if (asked.size === 0) return undefined;
  let best: { score: number; answer: string } | undefined;
  for (const { question, answer } of profile.answers) {
    const saved = words(question);
    let shared = 0;
    for (const w of saved) if (asked.has(w)) shared++;
    const score = shared / Math.max(saved.size, asked.size);
    if (score >= 0.7 && (!best || score > best.score)) best = { score, answer };
  }
  return best?.answer;
}

/**
 * Sets a value the way typing would, so frameworks that track input
 * (React, Angular, Vue) see it: the native setter, then input and change.
 */
function setValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const view = el.ownerDocument.defaultView;
  const proto =
    el instanceof (view?.HTMLTextAreaElement ?? HTMLTextAreaElement)
      ? (view?.HTMLTextAreaElement ?? HTMLTextAreaElement).prototype
      : el instanceof (view?.HTMLSelectElement ?? HTMLSelectElement)
        ? (view?.HTMLSelectElement ?? HTMLSelectElement).prototype
        : (view?.HTMLInputElement ?? HTMLInputElement).prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the element as `this`
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
  el.dispatchEvent(new Event('blur'));
}

const norm = (s: string) => normalizeLabel(s);

/** The option that matches a value: exact text, then a prefix, then yes/no meaning. */
function pickOption(options: { text: string; value: string }[], value: string): string | undefined {
  const want = norm(value);
  if (!want) return undefined;
  const real = options.filter(
    (o) => o.value !== '' && !/^(select|choose|please select)\b/i.test(o.text.trim()),
  );
  const exact = real.find((o) => norm(o.text) === want || norm(o.value) === want);
  if (exact) return exact.value;
  if (want === 'yes' || want === 'no')
    return real.find((o) => new RegExp(`^${want}\\b`).test(norm(o.text)))?.value;
  return real.find((o) => norm(o.text).startsWith(want) || want.startsWith(norm(o.text)))?.value;
}

function isEmpty(field: FormField): boolean {
  const [el] = field.elements;
  if (!el) return false;
  // A combobox shows its choice beside the input; its own value is only the search text.
  if (field.kind === 'combobox') {
    const container = comboboxContainer(el);
    return !container?.querySelector('[class*="single-value" i], [class*="singleValue" i]');
  }
  if (field.kind === 'radio') return !field.elements.some((r) => (r as HTMLInputElement).checked);
  if (field.kind === 'select') {
    const select = el as HTMLSelectElement;
    const chosen = select.options[select.selectedIndex];
    return (
      !chosen || chosen.value === '' || /^(select|choose|please select)\b/i.test(chosen.text.trim())
    );
  }
  return (el as HTMLInputElement).value.trim() === '';
}

/** A soft outline on filled fields, so the user can see what to check. */
function mark(el: HTMLElement): void {
  el.setAttribute('data-rolestash-filled', '');
  el.style.outline = '2px solid rgba(16, 185, 129, 0.7)';
  el.style.outlineOffset = '1px';
  el.addEventListener(
    'focus',
    () => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    },
    { once: true },
  );
}

/** A combobox's own wrapper (react-select's container), never a page-level one. */
function comboboxContainer(el: HTMLElement): HTMLElement | undefined {
  const own = ownAncestors(el, 6);
  return own.find((n) => /container/i.test(n.className)) ?? own.at(-1);
}

/** How long to wait for a type-to-search dropdown to show its options. */
export const COMBOBOX_WAIT_MS = 1500;
/** …and how long to wait for it to open at all. */
const OPEN_WAIT_MS = 300;

export interface FillOptions {
  comboboxWaitMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The options a combobox is showing: the listbox it names, or the menu inside its own wrapper. */
function comboboxOptions(el: HTMLElement): HTMLElement[] {
  const doc = el.ownerDocument;
  const ids = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`
    .split(/\s+/)
    .filter(Boolean);
  for (const id of ids) {
    const list = doc.getElementById(id);
    const options = list ? [...list.querySelectorAll<HTMLElement>('[role="option"]')] : [];
    if (options.length) return options;
  }
  // react-select renders its menu next to the input, inside the same container.
  const container = comboboxContainer(el);
  // Never a page-wide search: another dropdown's list (a phone-country picker) would match.
  return container
    ? [...container.querySelectorAll<HTMLElement>('[role="option"], [class*="option" i]')]
    : [];
}

function press(option: HTMLElement): void {
  for (const type of ['mousedown', 'mouseup', 'click'])
    option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

/** Types into a type-to-search dropdown and picks the matching option. */
async function fillCombobox(el: HTMLInputElement, value: string, waitMs: number): Promise<boolean> {
  el.focus();
  setValue(el, value);
  for (let waited = 0; waited <= waitMs; waited += 50) {
    const options = comboboxOptions(el);
    const pick = options.length
      ? pickOption(
          options.map((o, i) => ({ text: o.textContent, value: String(i) })),
          value,
        )
      : undefined;
    const option = pick === undefined ? undefined : options[Number(pick)];
    if (option) {
      press(option);
      mark(comboboxContainer(el) ?? el);
      return true;
    }
    // Some dropdowns only open for a real person's input. When it hasn't
    // opened soon, stop waiting and leave it for the user.
    if (
      waited >= OPEN_WAIT_MS &&
      options.length === 0 &&
      el.getAttribute('aria-expanded') === 'false'
    )
      break;
    await sleep(50);
  }
  setValue(el, ''); // nothing matched: leave it as it was
  return false;
}

async function fillOne(field: FormField, value: string, waitMs: number): Promise<boolean> {
  const [el] = field.elements;
  if (!el) return false;
  if (field.kind === 'combobox') return fillCombobox(el as HTMLInputElement, value, waitMs);
  if (field.kind === 'select') {
    const select = el as HTMLSelectElement;
    const option = pickOption(
      [...select.options].map((o) => ({ text: o.text, value: o.value })),
      value,
    );
    if (option === undefined) return false;
    setValue(select, option);
    mark(select);
    return true;
  }
  if (field.kind === 'radio') {
    const radios = field.elements as HTMLInputElement[];
    const options = radios.map((r) => ({
      text: r.labels?.[0]?.textContent ?? r.closest('label')?.textContent ?? r.value,
      value: r.value,
    }));
    const option = pickOption(options, value);
    const radio = radios.find((r) => r.value === option);
    if (!radio) return false;
    radio.click();
    mark(radio.closest('label') ?? radio);
    return true;
  }
  setValue(el as HTMLInputElement, value);
  mark(el);
  return true;
}

export async function fillForm(
  doc: Document,
  profile: Profile,
  options: FillOptions = {},
): Promise<FillReport> {
  const waitMs = options.comboboxWaitMs ?? COMBOBOX_WAIT_MS;
  const report: FillReport = { filled: [], skipped: [], files: [] };
  const ats = detectAts(doc);
  if (ats) report.ats = ats;
  for (const field of scanForm(doc)) {
    const skip = (reason: SkipReason) =>
      report.skipped.push({ label: field.label, reason, required: field.required });
    if (field.kind === 'file') {
      report.files.push(field.label);
      continue;
    }
    if (field.sensitive) {
      skip('sensitive');
      continue;
    }
    if (!isEmpty(field)) {
      if (field.key) skip('filled_already');
      continue;
    }
    const answer = field.key ? undefined : savedAnswer(field.label, profile);
    const value = field.key ? valueFor(field.key, profile) : answer;
    if (!value) {
      skip(field.key ? 'no_value' : 'unknown');
      continue;
    }
    if (await fillOne(field, value, waitMs))
      report.filled.push({ key: field.key ?? 'answer', label: field.label });
    else skip('no_option');
  }
  return report;
}
