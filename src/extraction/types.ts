import type { EmploymentType, Salary, WorkplaceType } from '@/domain/job';
import type { SiteAdapter } from './adapters/types';

/** Bump when extraction output changes meaningfully; stored on each job for debugging. */
export const EXTRACTOR_VERSION = '1.1.0';

export interface ExtractedFields {
  title: string;
  company: string;
  location: string;
  workplaceType: WorkplaceType;
  employmentTypes: EmploymentType[];
  salary: Salary;
  postedAt: string;
  closesAt: string;
  description: string;
  externalId: string;
  applyUrl: string;
}
export type FieldKey = keyof ExtractedFields;

/**
 * Strategy identifiers, highest-trust first. `adapter:*` ids carry the
 * sub-source so provenance tells you exactly which rule produced a value.
 */
export type StrategyId =
  | 'json-ld'
  | 'microdata'
  | 'adapter:selector'
  | 'adapter:custom'
  | 'adapter:title-pattern'
  | 'adapter:url'
  | 'meta'
  | 'heuristic';

export interface FieldValue<K extends FieldKey = FieldKey> {
  value: ExtractedFields[K];
  confidence: number;
  strategy: StrategyId;
}

/** What one strategy found. Each field carries its own confidence (0..1). */
export type StrategyOutput = {
  [K in FieldKey]?: FieldValue<K>;
};

export interface ExtractionContext {
  doc: Document;
  url: URL;
  adapter: SiteAdapter | undefined;
  now: Date;
}

export interface Strategy {
  id: string;
  run(ctx: ExtractionContext): StrategyOutput;
}

export interface ExtractionResult {
  /** Canonical URL (tracking stripped, SPA list URLs resolved to the job URL). */
  url: string;
  originalUrl: string;
  site: { id: string; name: string };
  fields: Partial<ExtractedFields>;
  provenance: Partial<Record<FieldKey, { strategy: StrategyId; confidence: number }>>;
  /** Weighted 0..1 score over the fields that matter most. */
  confidence: number;
  /** Heuristic: does this look like a single job posting at all? */
  isJobPage: boolean;
  warnings: string[];
  extractorVersion: string;
  /** True when the result came from an iframe rather than the top document. */
  fromFrame?: boolean;
}
