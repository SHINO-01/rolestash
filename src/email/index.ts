/**
 * Email status updates (ADR-0014): the pure engine. No chrome, React or
 * storage imports, and no DOM, so the same code runs in the extension and in
 * the Cloudflare Email Worker.
 */
export { analyzeEmail, parseSender } from './analyze';
export { matchEvent, targetStage, canonicalPostingUrl, normalizeCompany } from './match';
export type { MatchMemory, MatchResult, MatchCandidate } from './match';
export * from './types';
