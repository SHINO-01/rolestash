import type { EmploymentType, WorkplaceType } from '@/domain/job';

/**
 * Keyword classifiers for employment and workplace type. Inputs come from
 * schema.org enums (FULL_TIME, TELECOMMUTE) and free text ("Full time",
 * "Contract/Temp", "Hybrid remote").
 */

const EMPLOYMENT_RULES: [RegExp, EmploymentType][] = [
  [/full[\s_-]?time|permanent|\bFT\b/i, 'full-time'],
  [/part[\s_-]?time|\bPT\b/i, 'part-time'],
  [/contract(or)?|freelance|fixed[\s-]term/i, 'contract'],
  [/temp(orary)?\b|per[\s_]diem|seasonal/i, 'temporary'],
  [/casual/i, 'casual'],
  [/intern(ship)?|vacation(al)? (program|student)|co-?op\b/i, 'internship'],
  [/graduate|grad program|early career/i, 'graduate'],
  [/volunteer/i, 'volunteer'],
];

export function classifyEmploymentTypes(input: unknown): EmploymentType[] {
  const values = (Array.isArray(input) ? input : [input]).filter(
    (v): v is string => typeof v === 'string',
  );
  const found = new Set<EmploymentType>();
  for (const value of values) {
    for (const [re, type] of EMPLOYMENT_RULES) if (re.test(value)) found.add(type);
  }
  return [...found];
}

export function classifyWorkplace(...texts: (string | undefined)[]): WorkplaceType | undefined {
  const text = texts.filter(Boolean).join(' ');
  if (!text) return undefined;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (/\bTELECOMMUTE\b|\bremote\b|work from home|\bWFH\b|anywhere/i.test(text)) return 'remote';
  if (/on[\s-]?site|in[\s-]office|in[\s-]person/i.test(text)) return 'onsite';
  return undefined;
}
