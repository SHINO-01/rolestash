import type { ExtractionResult } from '@/extraction';

/**
 * Ports the service layer depends on. Implementations live in src/platform
 * (real browser APIs) and tests/ (fakes).
 */

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
}

export interface ExtractorRunner {
  /** One result per frame the extractor could run in. */
  run(tabId: number): Promise<ExtractionResult[]>;
  /** Raw page HTML — used by the "download fixture" developer tool. */
  snapshot(tabId: number): Promise<PageSnapshot>;
}

/** Browser-driven OAuth (chrome.identity.launchWebAuthFlow in production). */
export interface WebAuthFlow {
  /** Where the provider redirects back to, e.g. https://<id>.chromiumapp.org/ */
  redirectUrl(): string;
  /** Opens `url` for the user and resolves with the final redirect URL. */
  launch(url: string): Promise<string>;
}
