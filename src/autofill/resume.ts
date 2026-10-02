import type { Profile } from '../domain/profile';

/**
 * Reads autofill profile details from a résumé's plain text (ADR-0020
 * addendum). Deterministic rules, no AI: contact details and links are
 * reliable; name, location and the current role are best guesses that the
 * person checks before saving. The text comes from the file on this device
 * and is never stored or sent.
 */

export type ResumeField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'city'
  | 'region'
  | 'country'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'currentTitle'
  | 'currentCompany';

export type ResumeDetails = Partial<Pick<Profile, ResumeField>>;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// "+61 400 123 456", "(02) 9876 5432", "0400-123-456", "+1 (555) 010-0199".
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{6,16}\d/g;
const URL_LIKE =
  /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;|)]*)?/gi;

const SECTION =
  /^(experience|work experience|professional experience|employment|employment history|work history|career history)\s*:?$/i;
const OTHER_SECTION =
  /^(education|skills|technical skills|projects|certifications?|awards|interests|references|summary|profile|about me|objective|languages|volunteering|publications)\s*:?$/i;
const NOT_A_NAME =
  /\b(resume|résumé|curriculum|vitae|cv|profile|summary|contact|address|phone|email|linkedin|github)\b/i;

const TITLE_WORDS =
  /\b(engineer|developer|manager|analyst|designer|consultant|lead|officer|specialist|coordinator|director|assistant|intern|scientist|architect|administrator|associate|advisor|adviser|nurse|teacher|accountant|programmer|technician|representative|executive|head|principal|researcher|editor|writer|marketer|recruiter|owner|founder|tester|support|operator|supervisor|clerk|producer|strategist|planner|partner|graduate)\b/i;
const DATES =
  /\b((19|20)\d{2}|present|current|now|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

const COUNTRIES = [
  'Australia',
  'New Zealand',
  'United Kingdom',
  'UK',
  'Ireland',
  'United States',
  'USA',
  'Canada',
  'India',
  'Singapore',
  'Germany',
  'France',
  'Netherlands',
];
const COUNTRY_NAMES: Record<string, string> = {
  UK: 'United Kingdom',
  USA: 'United States',
};

function clean(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Header segments: résumés separate contact details with |, •, · or tabs. */
function segments(line: string): string[] {
  return line
    .split(/\s*[|•·▪●◦]\s*|\t+|\s{3,}/)
    .map(clean)
    .filter(Boolean);
}

function findPhone(text: string): string | undefined {
  for (const m of text.matchAll(PHONE)) {
    const raw = clean(m[0]);
    const digits = raw.replace(/\D/g, '');
    // Years ("2019 - 2023") and dates look like numbers too.
    if (digits.length < 8 || digits.length > 15) continue;
    if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(raw)) continue;
    return raw;
  }
  return undefined;
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.replace(/[.,;:)]+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function findLinks(text: string): Pick<ResumeDetails, 'linkedin' | 'github' | 'website'> {
  const out: Pick<ResumeDetails, 'linkedin' | 'github' | 'website'> = {};
  const withoutEmails = text.replace(new RegExp(EMAIL.source, 'g'), ' ');
  for (const m of withoutEmails.matchAll(URL_LIKE)) {
    const url = normaliseUrl(m[0]);
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (host.endsWith('linkedin.com')) {
      if (url.includes('/in/')) out.linkedin ??= url;
    } else if (host === 'github.com') {
      if (/github\.com\/[A-Za-z0-9-]+/.test(url)) out.github ??= url;
    } else if (/^https?:\/\//i.test(m[0]) || m[0].toLowerCase().startsWith('www.')) {
      // Only explicit links count as a website: bare "node.js" or "asp.net" are skills.
      out.website ??= url;
    }
  }
  return out;
}

function looksLikeName(line: string): boolean {
  if (NOT_A_NAME.test(line) || EMAIL.test(line) || /\d/.test(line)) return false;
  const words = line.split(' ');
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((w) => /^[\p{Lu}][\p{L}'’-]*\.?$/u.test(w) || /^[\p{Lu}'’-]{2,}$/u.test(w))
  );
}

function titleCase(word: string): string {
  return word === word.toUpperCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word;
}

function findName(header: string[]): Pick<ResumeDetails, 'firstName' | 'lastName'> {
  for (const line of header) {
    for (const part of segments(line)) {
      if (!looksLikeName(part)) continue;
      const words = part.split(' ').map((w) => w.split('-').map(titleCase).join('-'));
      return { firstName: words[0] ?? '', lastName: words.slice(1).join(' ') };
    }
  }
  return {};
}

function findLocation(header: string[]): Pick<ResumeDetails, 'city' | 'region' | 'country'> {
  for (const line of header) {
    for (const part of segments(line)) {
      if (EMAIL.test(part) || /\d{3}/.test(part) || /https?:|www\./i.test(part)) continue;
      const bits = part.split(/\s*,\s*/).filter(Boolean);
      if (bits.length < 2 || bits.length > 3) continue;
      if (!bits.every((b) => /^[\p{Lu}][\p{L} .'’-]{1,40}$/u.test(b))) continue;
      const last = bits[bits.length - 1] ?? '';
      const country = COUNTRIES.find((c) => c.toLowerCase() === last.toLowerCase());
      const out: Pick<ResumeDetails, 'city' | 'region' | 'country'> = { city: bits[0] ?? '' };
      if (country) {
        out.country = COUNTRY_NAMES[country] ?? country;
        if (bits.length === 3) out.region = bits[1] ?? '';
      } else {
        out.region = bits[1] ?? '';
      }
      return out;
    }
  }
  return {};
}

/** "Senior Engineer at Northwind", "Northwind — Senior Engineer", or two lines. */
function splitRole(line: string): { title: string; company: string } | undefined {
  const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(line);
  if (at?.[1] && at[2]) return { title: at[1], company: at[2] };
  const parts = line
    .split(/\s+[—–|-]\s+|,\s+/)
    .map(clean)
    .filter(Boolean);
  if (parts.length >= 2) {
    const [a = '', b = ''] = parts;
    if (TITLE_WORDS.test(a) && !TITLE_WORDS.test(b)) return { title: a, company: b };
    if (TITLE_WORDS.test(b) && !TITLE_WORDS.test(a)) return { title: b, company: a };
  }
  return undefined;
}

function stripDates(line: string): string {
  return clean(
    line
      .replace(
        /\(?\b((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*[-–—to]+\s*(((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}|present|current|now)\)?/gi,
        '',
      )
      .replace(/[|,–—-]\s*$/, ''),
  );
}

function findRole(lines: string[]): Pick<ResumeDetails, 'currentTitle' | 'currentCompany'> {
  const start = lines.findIndex((l) => SECTION.test(l));
  if (start < 0) return {};
  const entry: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    if (OTHER_SECTION.test(raw) || SECTION.test(raw)) break;
    const line = stripDates(raw);
    // Bullets describe the job; the entry's heading comes before them.
    if (!line || /^[•\-*▪●◦]/.test(raw.trim())) {
      if (entry.length) break;
      continue;
    }
    if (DATES.test(raw) && line.length < 3) continue;
    entry.push(line);
    if (entry.length === 2) break;
  }
  const [first, second] = entry;
  if (!first) return {};
  const split = splitRole(first);
  if (split) return { currentTitle: split.title, currentCompany: split.company };
  if (second && second.length <= 80) {
    if (TITLE_WORDS.test(first)) return { currentTitle: first, currentCompany: second };
    if (TITLE_WORDS.test(second)) return { currentTitle: second, currentCompany: first };
  }
  return {};
}

/** What a résumé says about its owner, as far as plain rules can tell. */
export function readResume(text: string): ResumeDetails {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').trimEnd())
    .filter((l) => l.trim().length > 0)
    .map((l) => l.trim());
  // Contact details live in the first lines, before the first section.
  const firstSection = lines.findIndex((l) => SECTION.test(l) || OTHER_SECTION.test(l));
  const header = lines.slice(0, Math.min(firstSection < 0 ? 8 : firstSection, 10));
  const headerText = header.join('\n');

  const email = EMAIL.exec(headerText)?.[0] ?? EMAIL.exec(text)?.[0];
  const phone = findPhone(headerText) ?? findPhone(lines.slice(0, 20).join('\n'));
  const details: ResumeDetails = {
    ...findName(header),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(phone ? { phone } : {}),
    ...findLocation(header),
    ...findLinks(text),
    ...findRole(lines),
  };
  // Drop anything empty, and cap lengths to the profile's limits.
  const out: ResumeDetails = {};
  for (const [k, v] of Object.entries(details) as [ResumeField, string | undefined][]) {
    const value = v?.trim();
    if (value) out[k] = value.slice(0, k === 'phone' ? 40 : 200);
  }
  return out;
}
