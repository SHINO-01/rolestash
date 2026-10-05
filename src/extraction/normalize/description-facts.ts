import type { Salary, WorkplaceType } from '@/domain/job';
import { classifyWorkplace } from './classifiers';
import { parseSalaryText } from './salary';
import { cleanText } from './text';

/**
 * Location, salary and workplace from the posting's own words, for when the
 * page's structured data and the site adapter didn't give them. Postings
 * often say "Location: Sydney", "Salary range: $120,000 – $140,000" or "This
 * is a hybrid role" only in the description.
 *
 * Conservative on purpose: labelled lines first, then a few unambiguous
 * phrases. When the text points two ways ("remote" and "on-site"), the
 * workplace stays empty rather than guessed. Every pattern is bounded, so
 * the time taken stays linear in the description's length.
 */

export interface DescriptionFacts {
  location?: string;
  salary?: Salary;
  workplaceType?: WorkplaceType;
}

/** Long descriptions are mostly boilerplate; the facts are near the top. */
const MAX_SCAN = 20_000;

// "• Job location: Macquarie Park, NSW" — a bullet or dash may lead the line.
const LEAD = String.raw`^[ \t•*·\-–—]{0,4}`;
const SEP = String.raw`[ \t]{0,3}[:|–—-][ \t]{0,3}`;

const LOCATION_LINE = new RegExp(
  `${LEAD}(?:job |work |office |primary |based )?locations?(?: \\(s\\))?${SEP}([^\\n]{2,100})$`,
  'gim',
);
const SALARY_LINE = new RegExp(
  `${LEAD}(?:base |annual |hourly |the )?(?:salary|pay|compensation|remuneration|wage|rate|package)(?: range| band| rate)?(?: \\([^)\\n]{1,20}\\))?${SEP}([^\\n]{2,140})$`,
  'gim',
);
const WORKPLACE_LINE = new RegExp(
  `${LEAD}(?:workplace(?: type)?|work(?:ing)? (?:arrangement|model|mode|style|location|setup|pattern)|location type|arrangement|remote(?: status| work)?)${SEP}([^\\n]{2,60})$`,
  'gim',
);

/** LinkedIn's recruiter hashtags ("#LI-Hybrid") are the clearest signal there is. */
const HASHTAG: [RegExp, WorkplaceType][] = [
  [/#LI-Hybrid\b/i, 'hybrid'],
  [/#LI-Remote\b/i, 'remote'],
  [/#LI-Onsite\b/i, 'onsite'],
];

const PHRASES: [RegExp, WorkplaceType][] = [
  [
    /\bhybrid[ -](?:role|position|job|opportunity|working|work|model|arrangement|schedule|environment|basis)\b/i,
    'hybrid',
  ],
  [/\b(?:role|position|job) is (?:a )?hybrid\b/i, 'hybrid'],
  [
    /\b\d(?: ?(?:-|to|or) ?\d)? days? (?:a|per|each) week (?:in|at|from) (?:the|our|an?) (?:office|site)\b/i,
    'hybrid',
  ],
  [/\b(?:fully|100%|completely|entirely) remote\b/i, 'remote'],
  [/\bremote[ -](?:first|role|position|job|opportunity)\b/i, 'remote'],
  [/\b(?:roles?|positions?|jobs?) (?:is|are) (?:fully )?remote\b/i, 'remote'],
  [/\bon[ -]?site[ -](?:role|position|job|opportunity|only)\b/i, 'onsite'],
  [
    /\b(?:role|position|job) is (?:fully |100% )?(?:on[ -]?site|office[ -]based|in[ -]office)\b/i,
    'onsite',
  ],
  [/\boffice[ -]based (?:role|position|job)\b/i, 'onsite'],
];

/** A sentence that talks about pay, with an amount that has a currency. */
const PAY_WORDS =
  /\b(?:salary|salaries|pay|paid|compensation|remuneration|wage|package|base|per annum|p\.?a\.?|per hour|an hour|a year|per year|hourly rate|day rate)\b/i;
const MONEY = /(?:A\$|AU\$|US\$|NZ\$|C\$|CA\$|S\$|[$£€₹])\s?\d/;
const NOT_PAY =
  /\b(?:million|billion|funding|raised|revenue|valuation|turnover|bonus pool|series [a-e]|[0-9.]+ ?(?:m|bn|b)\b)/i;

export function factsFromDescription(
  description: string | undefined,
  defaultCurrency?: string,
): DescriptionFacts {
  if (!description) return {};
  const text = description.slice(0, MAX_SCAN);
  const facts: DescriptionFacts = {};

  const location = firstGroup(LOCATION_LINE, text)
    .map(cleanLocation)
    .find((value) => value.length >= 2);
  if (location) facts.location = location;

  const salary = salaryFrom(text, defaultCurrency);
  if (salary) facts.salary = salary;

  const workplace = workplaceFrom(text, location);
  if (workplace) facts.workplaceType = workplace;
  return facts;
}

function firstGroup(re: RegExp, text: string): string[] {
  re.lastIndex = 0;
  return [...text.matchAll(re)].map((m) => cleanText(m[1])).filter(Boolean);
}

/** "Sydney NSW." → "Sydney NSW"; drops a trailing sentence after the place. */
function cleanLocation(value: string): string {
  const [place = ''] = value.split(/(?<=[a-z0-9)])\. /i);
  return place.replace(/[.;,]+$/, '').trim();
}

function plausible(salary: Salary | undefined): salary is Salary {
  if (salary?.min === undefined) return false;
  const top = salary.max ?? salary.min;
  if (top > 5_000_000) return false;
  // Hourly and daily rates are small; yearly pay isn't a few hundred.
  if (salary.period === 'year') return salary.min >= 5_000;
  return salary.min >= 5;
}

function salaryFrom(text: string, defaultCurrency?: string): Salary | undefined {
  for (const value of firstGroup(SALARY_LINE, text)) {
    const salary = parseSalaryText(value, defaultCurrency);
    if (plausible(salary)) return salary;
  }
  // Unlabelled: "The base salary for this role is $120,000 – $140,000 + super."
  for (const sentence of text.split(/\n|(?<=[a-z)])\. /)) {
    const at = sentence.search(MONEY);
    if (at < 0 || !PAY_WORDS.test(sentence) || NOT_PAY.test(sentence)) continue;
    const window = sentence.slice(Math.max(0, at - 10), at + 120);
    const salary = parseSalaryText(window, defaultCurrency);
    if (plausible(salary)) return salary;
  }
  return undefined;
}

function workplaceFrom(text: string, location: string | undefined): WorkplaceType | undefined {
  for (const value of firstGroup(WORKPLACE_LINE, text)) {
    const labelled = classifyWorkplace(value);
    if (labelled) return labelled;
  }
  for (const [re, type] of HASHTAG) if (re.test(text)) return type;
  // "Location: Sydney (Hybrid)"
  const fromLocation = location ? classifyWorkplace(location) : undefined;
  if (fromLocation) return fromLocation;
  const found = new Set(PHRASES.filter(([re]) => re.test(text)).map(([, type]) => type));
  return found.size === 1 ? [...found][0] : undefined;
}
