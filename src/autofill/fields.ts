/**
 * Reading a form: which controls exist, what each one asks for, and which
 * profile field answers it. Deterministic rules, no AI (ADR-0020). Works on
 * any Document, so the same code runs in the page and in tests.
 */

export const FIELD_KEYS = [
  'firstName',
  'lastName',
  'fullName',
  'preferredName',
  'email',
  'phone',
  'addressLine1',
  'city',
  'region',
  'postcode',
  'country',
  'location',
  'linkedin',
  'github',
  'website',
  'currentCompany',
  'currentTitle',
  'workAuthorization',
  'needsSponsorship',
  'salaryExpectation',
  'noticePeriod',
  'howHeard',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** `combobox`: a type-to-search dropdown (react-select and similar). */
export type ControlKind = 'text' | 'textarea' | 'select' | 'combobox' | 'radio' | 'file';

export interface FormField {
  kind: ControlKind;
  /** What the form asks, as a person reads it. */
  label: string;
  /** The profile field that answers it, when known. */
  key?: FieldKey;
  /** Never filled: demographic, identity or secret questions. */
  sensitive: boolean;
  required: boolean;
  /** The control (radio: every radio in the group). */
  elements: HTMLElement[];
}

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'smartrecruiters';

/** Which recruiting system's form this is, from the URL or its markup. */
export function detectAts(doc: Document): Ats | undefined {
  // A parsed document (no browsing context) has no location.
  const host = (doc.location as Location | null)?.hostname.toLowerCase() ?? '';
  // The host decides first: pages embed each other's ids (Lever's form is also #application-form).
  if (/(^|\.)greenhouse\.io$/.test(host)) return 'greenhouse';
  if (/(^|\.)lever\.co$/.test(host)) return 'lever';
  if (/(^|\.)ashbyhq\.com$/.test(host)) return 'ashby';
  if (/myworkday(jobs)?\.com$/.test(host)) return 'workday';
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return 'smartrecruiters';
  // White-labelled forms on a company's own domain, by their markup.
  if (doc.querySelector('[data-automation-id="legalNameSection_firstName"]')) return 'workday';
  if (doc.querySelector('[name^="_systemfield_"]')) return 'ashby';
  if (doc.querySelector('form#application_form, [name^="job_application["]')) return 'greenhouse';
  return undefined;
}

/**
 * Exact rules per recruiting system: a selector names the field outright.
 * Checked before the general rules below.
 */
const ATS_RULES: Record<Ats, [string, FieldKey][]> = {
  greenhouse: [
    ['#first_name', 'firstName'],
    ['#last_name', 'lastName'],
    ['#preferred_name', 'preferredName'],
    ['#email', 'email'],
    ['#phone', 'phone'],
    [
      '#candidate-location, #job_application_location, [name="job_application[location]"]',
      'location',
    ],
  ],
  lever: [
    ['[name="name"]', 'fullName'],
    ['[name="email"]', 'email'],
    ['[name="phone"]', 'phone'],
    ['[name="location"]', 'location'],
    ['[name="org"]', 'currentCompany'],
    ['[name="urls[LinkedIn]"]', 'linkedin'],
    ['[name="urls[GitHub]"]', 'github'],
    ['[name="urls[Portfolio]"], [name="urls[Other]"], [name="urls[Website]"]', 'website'],
  ],
  ashby: [
    ['[name="_systemfield_name"]', 'fullName'],
    ['[name="_systemfield_email"]', 'email'],
    ['[name="_systemfield_phone"]', 'phone'],
    ['[name="_systemfield_location"]', 'location'],
  ],
  workday: [
    ['[data-automation-id="legalNameSection_firstName"]', 'firstName'],
    ['[data-automation-id="legalNameSection_lastName"]', 'lastName'],
    ['[data-automation-id="preferredNameSection_firstName"]', 'preferredName'],
    ['[data-automation-id="email"]', 'email'],
    ['[data-automation-id="phone-number"]', 'phone'],
    ['[data-automation-id="addressSection_addressLine1"]', 'addressLine1'],
    ['[data-automation-id="addressSection_city"]', 'city'],
    ['[data-automation-id="addressSection_postalCode"]', 'postcode'],
    ['[data-automation-id="linkedinQuestion"]', 'linkedin'],
  ],
  smartrecruiters: [
    ['[name="firstName"], #first-name-input', 'firstName'],
    ['[name="lastName"], #last-name-input', 'lastName'],
    ['[name="email"], #email-input', 'email'],
    ['[name="confirmEmail"], #confirm-email-input', 'email'],
    ['[name="phoneNumber"], #phone-number-input', 'phone'],
    ['[name="linkedin"], #linkedin-input', 'linkedin'],
  ],
};

/** The browser's own field names (`autocomplete`) say exactly what a field is. */
const AUTOCOMPLETE: Record<string, FieldKey> = {
  'given-name': 'firstName',
  'family-name': 'lastName',
  name: 'fullName',
  nickname: 'preferredName',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'address-line1': 'addressLine1',
  'street-address': 'addressLine1',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postcode',
  country: 'country',
  'country-name': 'country',
  organization: 'currentCompany',
  'organization-title': 'currentTitle',
};

/**
 * Questions autofill never answers, whatever the profile holds: equal
 * opportunity and demographic questions, identity numbers and secrets.
 */
const SENSITIVE =
  /\b(gender|sex|pronouns?|race|racial|ethnic\w*|hispanic|latin[oax]|veteran|military status|disabilit\w*|disabled|handicap|sexual orientation|lgbt\w*|transgender|religio\w*|date of birth|birth ?date|dob|age|criminal|convict\w*|marital|aboriginal|torres strait|indigenous|first nations|social security|ssn|tax file|tfn|national insurance|passport|driver'?s? licen[cs]e|bank|bsb|credit card|password|captcha)\b/;

/** Questions about a field that aren't the field ("How do you pronounce your name?"). */
const NOT_A_FIELD = /\bpronounc\w*\b|\bphonetic\b|\bspell\w* of your name\b/;

/** Anti-spam fields that aren't questions. */
const MACHINE_FIELD = /captcha|honeypot|^h-captcha|^g-recaptcha/i;

/** Every form control in the document and its open shadow roots. */
function controls(root: Document | ShadowRoot): HTMLElement[] {
  const out = [...root.querySelectorAll<HTMLElement>('input, select, textarea')];
  for (const el of root.querySelectorAll<HTMLElement>('*'))
    if (el.shadowRoot) out.push(...controls(el.shadowRoot));
  return out;
}

/** General rules, in order: the first match wins. */
const RULES: [RegExp, FieldKey][] = [
  [
    /\bpreferred (first )?name\b|\bnick ?name\b|\bknown as\b|\bname you('d| would)? (prefer|like)\b|\bprefer(red)? to be (called|addressed)\b/,
    'preferredName',
  ],
  [/\b(first|given|fore) ?name\b|^first$/, 'firstName'],
  [/\b(last|family|sur) ?name\b|^surname$|^last$/, 'lastName'],
  [/\be-?mail\b/, 'email'],
  [/\b(phone|mobile|cell|telephone)\b(?!.*\b(type|device|extension|code)\b)/, 'phone'],
  [/\blinked ?in\b/, 'linkedin'],
  [/\bgit ?hub\b/, 'github'],
  [/\b(website|portfolio|personal (site|url|page)|blog)\b/, 'website'],
  [/\b(visa )?sponsor(ship)?\b/, 'needsSponsorship'],
  [
    /\b(legally )?(authori[sz]ed|eligible|entitled|allowed|right) to work\b|\bwork (rights|authori[sz]ation|permit)\b/,
    'workAuthorization',
  ],
  [
    /\b(salary|compensation|remuneration|pay)\b.*\b(expect\w*|requir\w*|desired)\b|\b(expected|desired|target) (salary|compensation|pay|remuneration)\b/,
    'salaryExpectation',
  ],
  [
    /\bnotice period\b|\b(earliest|available|availability|possible) (start )?date\b|\bwhen (can|could) you start\b|\bavailab(le|ility) to start\b/,
    'noticePeriod',
  ],
  [
    /\bhow did you (hear|find|learn)\b|\bwhere did you (hear|find|see)\b|\bhow you heard\b/,
    'howHeard',
  ],
  [
    /\b(current|present|most recent|latest) (company|employer|organi[sz]ation)\b|^(company|employer|current employer)$/,
    'currentCompany',
  ],
  [
    /\b(current|present|most recent|latest) (job )?(title|role|position)\b|^(job )?title$/,
    'currentTitle',
  ],
  [/\b(post ?code|postal code|zip( code)?)\b/, 'postcode'],
  [/\b(street|address( line)? ?1?)\b/, 'addressLine1'],
  [/\b(city|suburb|town)\b/, 'city'],
  [
    /^(state|province|region|county)\b|\b(state|province|region) of residence\b|\bstate\/province\b/,
    'region',
  ],
  [/\bcountry\b(?!.*\bcode\b)/, 'country'],
  [/\blocation\b|\bwhere are you (based|located)\b|\bcity, state\b/, 'location'],
  [/^(full |your |legal )?name\b|\bfull name\b|\blegal name\b/, 'fullName'],
];

/**
 * The most words a question may have and still mean a profile field. Long
 * questions that merely mention "current employer" or "country" are about
 * something else ("Are you bound by any agreements with your current
 * employer…"). Yes/no and free-text questions have no limit.
 */
const MAX_WORDS: Partial<Record<FieldKey, number>> = {
  firstName: 8,
  lastName: 8,
  fullName: 8,
  email: 8,
  phone: 8,
  addressLine1: 8,
  city: 8,
  region: 8,
  postcode: 8,
  linkedin: 10,
  github: 10,
  website: 10,
  currentCompany: 8,
  currentTitle: 8,
  country: 14,
  location: 14,
  preferredName: 16,
};

/** Lower case, words only: "First Name *" → "first name". */
export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** "first_name" or "firstName" → "first name". */
function humanize(id: string): string {
  return id
    .replace(/\[(\w+)\]/g, ' $1')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ');
}

const CONTROLS = 'input:not([type="hidden"]), select, textarea';

/**
 * The control's ancestors that hold no other question (up to `depth`
 * levels): its own field wrapper, never the whole form. A radio group
 * counts as one question.
 */
export function ownAncestors(el: HTMLElement, depth = 4): HTMLElement[] {
  const name = el.getAttribute('type') === 'radio' ? el.getAttribute('name') : null;
  const out: HTMLElement[] = [];
  for (let node = el.parentElement; node && out.length < depth; node = node.parentElement) {
    const others = [...node.querySelectorAll(CONTROLS)].filter(
      (c) => c !== el && !(name && c.getAttribute('name') === name),
    );
    if (others.length) break;
    out.push(node);
  }
  return out;
}

/** What a control asks: its label, as the page tells assistive tech. */
export function labelFor(el: HTMLElement): string {
  // Inside a web component, ids and labels live in its shadow root.
  const doc = el.getRootNode() as Document | ShadowRoot;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(doc.getElementById(id)))
      .join(' ')
      .trim();
    if (text) return text;
  }
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  if (el.id) {
    const label = [...doc.querySelectorAll('label[for]')].find(
      (l) => l.getAttribute('for') === el.id,
    );
    if (textOf(label)) return textOf(label);
  }
  const wrapping = el.closest('label');
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, option').forEach((c) => c.remove());
    if (textOf(clone)) return textOf(clone);
  }
  // A question container with its own label element (Workday, Ashby, custom forms).
  for (const node of ownAncestors(el)) {
    const legend = node.tagName === 'FIELDSET' ? node.querySelector('legend') : null;
    if (textOf(legend)) return textOf(legend);
    const label = node.querySelector(
      ':scope > label, :scope > [class*="label" i], :scope > [data-automation-id*="label" i]',
    );
    if (label && !label.contains(el) && textOf(label)) return textOf(label);
  }
  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();
  return humanize(el.getAttribute('name') ?? el.id).trim();
}

function isHidden(el: HTMLElement): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return true;
  // Real browsers know what's rendered (closed dropdowns, collapsed sections).
  if ('checkVisibility' in el && typeof el.checkVisibility === 'function' && !el.checkVisibility())
    return true;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.style.display === 'none' || node.style.visibility === 'hidden') return true;
  }
  return false;
}

function isRequired(el: HTMLElement, label: string): boolean {
  return (
    el.hasAttribute('required') ||
    el.getAttribute('aria-required') === 'true' ||
    /✱|\*\s*$/.test(label)
  );
}

/** Classifies one question. Exact system rules first, then `autocomplete`, then wording. */
export function classify(
  el: HTMLElement,
  label: string,
  ats: Ats | undefined,
): { key?: FieldKey; sensitive: boolean } {
  const words = normalizeLabel(`${label} ${humanize(el.getAttribute('name') ?? '')}`);
  if (SENSITIVE.test(words)) return { sensitive: true };
  if (NOT_A_FIELD.test(words)) return { sensitive: false };
  if (ats) {
    for (const [selector, key] of ATS_RULES[ats])
      if (el.matches(selector)) return { key, sensitive: false };
  }
  const autocomplete = el.getAttribute('autocomplete')?.toLowerCase().split(/\s+/).pop();
  if (autocomplete && AUTOCOMPLETE[autocomplete])
    return { key: AUTOCOMPLETE[autocomplete], sensitive: false };
  const byLabel = normalizeLabel(label);
  const wordCount = byLabel.split(' ').length;
  for (const [re, key] of RULES) {
    if (!re.test(byLabel)) continue;
    const max = MAX_WORDS[key];
    if (max !== undefined && wordCount > max) return { sensitive: false };
    return { key, sensitive: false };
  }
  // Fall back to the field's name/id ("first_name").
  const byName = normalizeLabel(humanize(el.getAttribute('name') ?? el.id));
  for (const [re, key] of RULES) if (byName && re.test(byName)) return { key, sensitive: false };
  return { sensitive: false };
}

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search', 'number']);

/** Every fillable question on the page, in document order. */
export function scanForm(doc: Document): FormField[] {
  const ats = detectAts(doc);
  const fields: FormField[] = [];
  const radioGroups = new Map<string, HTMLInputElement[]>();

  for (const el of controls(doc)) {
    if (isHidden(el) || (el as HTMLInputElement).disabled) continue;
    if (MACHINE_FIELD.test(`${el.getAttribute('name') ?? ''} ${el.id}`)) continue;
    const tag = el.tagName;
    let kind: ControlKind;
    if (tag === 'SELECT') kind = 'select';
    else if (tag === 'TEXTAREA') kind = 'textarea';
    else {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type === 'radio') {
        const name = el.getAttribute('name') ?? '';
        const group = radioGroups.get(name);
        if (group) {
          group.push(el as HTMLInputElement);
          continue;
        }
        radioGroups.set(name, [el as HTMLInputElement]);
        kind = 'radio';
      } else if (type === 'file') kind = 'file';
      else if (TEXT_TYPES.has(type)) kind = isCombobox(el) ? 'combobox' : 'text';
      else continue; // hidden, password, checkbox, submit, date pickers…
    }
    if ((el as HTMLInputElement).readOnly && kind !== 'select') continue;

    const label = kind === 'radio' ? radioLabel(el as HTMLInputElement) : labelFor(el);
    const { key, sensitive } = kind === 'file' ? { sensitive: false } : classify(el, label, ats);
    fields.push({
      kind,
      label: tidyLabel(label),
      ...(key ? { key } : {}),
      sensitive,
      required: isRequired(el, label),
      elements: kind === 'radio' ? (radioGroups.get(el.getAttribute('name') ?? '') ?? []) : [el],
    });
  }
  return fields;
}

/** "Current location ✱No location found…" → "Current location"; drops the required star. */
function tidyLabel(label: string): string {
  const head = label.split(/[✱*]/)[0]?.trim() ?? '';
  return (head || label).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function isCombobox(el: HTMLElement): boolean {
  const auto = el.getAttribute('aria-autocomplete');
  return el.getAttribute('role') === 'combobox' || auto === 'list' || auto === 'both';
}

/** A radio group's question: its fieldset legend or group label, not one option's text. */
function radioLabel(radio: HTMLInputElement): string {
  const group = radio.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (group) {
    const named = group.getAttribute('aria-labelledby');
    if (named) {
      const text = textOf((radio.getRootNode() as Document | ShadowRoot).getElementById(named));
      if (text) return text;
    }
    const aria = group.getAttribute('aria-label');
    if (aria) return aria;
    const legend = group.querySelector('legend, [class*="label" i], [class*="question" i]');
    if (textOf(legend)) return textOf(legend);
  }
  for (
    let node = radio.parentElement, depth = 0;
    node && depth < 5;
    node = node.parentElement, depth++
  ) {
    const label = [
      ...node.querySelectorAll(':scope > label, :scope > [class*="label" i], :scope > p'),
    ].find((l) => !l.querySelector('input'));
    if (label && textOf(label)) return textOf(label);
  }
  return humanize(radio.name);
}
