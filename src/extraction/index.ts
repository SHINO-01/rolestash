/** Public API of the extraction module. Import from '@/extraction', not from internals. */
export { extractJob, STRATEGIES, type ExtractOptions } from './extract';
export { toPosting, toExtractionMeta } from './to-posting';
export { SITE_ADAPTERS, resolveAdapter, findAdapterByHost } from './adapters/registry';
export type { SiteAdapter } from './adapters/types';
export { canonicalizeUrl } from './normalize/url';
export { formatSalary, parseSalaryText } from './normalize/salary';
export * from './types';
