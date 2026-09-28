import type { ExtractedFields, ExtractionContext } from '../types';

/**
 * A site adapter teaches the extractor about one job site or ATS platform.
 * Adapters are declarative by design: most are just host patterns plus a few
 * CSS selectors, so fixing a broken site is a one-line change.
 *
 * Authoring guide: docs/guides/adding-a-site-adapter.md
 */

export type AdapterKind = 'job-board' | 'ats' | 'government' | 'aggregator';

/** Market codes used for docs and for default currency on ambiguous "$". */
export type Region = 'global' | 'AU' | 'NZ' | 'US' | 'UK' | 'EU' | 'IN' | 'SEA';

export type SelectorField =
  | 'title'
  | 'company'
  | 'location'
  | 'salary'
  | 'employmentType'
  | 'workplaceType'
  | 'description'
  | 'postedAt'
  | 'closesAt'
  | 'applyUrl';

/**
 * Title pattern applied to `document.title`. Named groups `title`,
 * `company` and `location` are picked up automatically.
 */
export type TitlePattern = RegExp;

export interface SiteAdapter {
  /** Stable kebab-case id. Stored on every job — never rename a released id. */
  id: string;
  /** Display name, e.g. "LinkedIn". */
  name: string;
  kind: AdapterKind;
  regions: Region[];
  /** Public homepage, used in docs. */
  homepage: string;
  /**
   * Hostnames this adapter owns. A plain string matches the domain and any
   * subdomain ("seek.com.au" matches "www.seek.com.au"). Use a RegExp for
   * multi-TLD brands.
   */
  hosts: (string | RegExp)[];
  /**
   * Optional DOM fingerprint for white-labelled platforms hosted on customer
   * domains (e.g. Workday or SuccessFactors career sites). Only evaluated when
   * no adapter matched by host. Keep it cheap and specific.
   */
  detect?: (doc: Document) => boolean;
  /**
   * Map the current URL to the canonical posting URL. Return `undefined` to
   * fall back to generic canonicalisation. This is where list/search views
   * with a selected job (LinkedIn `currentJobId`, SEEK `jobId`) are resolved.
   */
  canonicalUrl?: (url: URL) => string | undefined;
  /** The site's own posting id, from the URL. */
  externalId?: (url: URL) => string | undefined;
  /** CSS selectors per field; the first selector yielding non-empty text wins. */
  selectors?: Partial<Record<SelectorField, string[]>>;
  titlePatterns?: TitlePattern[];
  /** Company from the URL, e.g. the tenant slug in `jobs.lever.co/{company}`. */
  companyFromUrl?: (url: URL) => string | undefined;
  /** Escape hatch for logic selectors can't express. Must not throw. */
  extract?: (ctx: ExtractionContext) => Partial<ExtractedFields>;
  /** Default ISO currency for "$" amounts on this site (may depend on the TLD). */
  defaultCurrency?: string | ((url: URL) => string | undefined);
  /**
   * Confidence for selector hits (0..1). Default 0.85 — slightly below
   * JSON-LD, so structured data wins when both exist.
   */
  selectorConfidence?: number;
  /** Knowledge base: quirks, login walls, iframe usage, etc. Rendered into docs. */
  notes?: string;
  /**
   * ISO date on which the selectors were last checked against the live site
   * (with a fixture committed). `undefined` = best-effort, not yet verified.
   */
  lastVerified?: string;
}

export function defineAdapter(adapter: SiteAdapter): SiteAdapter {
  return adapter;
}
