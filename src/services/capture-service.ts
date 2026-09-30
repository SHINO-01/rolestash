import type { ExtractionResult } from '@/extraction';
import type { ExtractorRunner } from './ports';

export type CaptureFailureReason = 'restricted' | 'no-result' | 'error';

export type CaptureOutcome =
  | { ok: true; result: ExtractionResult }
  | { ok: false; reason: CaptureFailureReason; message: string };

const RESTRICTED_URL =
  /^(chrome|edge|brave|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/i;

/** Runs the extractor in a tab and picks the best frame's result. */
export class CaptureService {
  constructor(private readonly runner: ExtractorRunner) {}

  async capture(tabId: number, tabUrl?: string): Promise<CaptureOutcome> {
    if (tabUrl && RESTRICTED_URL.test(tabUrl)) {
      return {
        ok: false,
        reason: 'restricted',
        message: 'Chrome doesn’t let extensions read this page. Open a job posting and try again.',
      };
    }
    try {
      const results = await this.runner.run(tabId);
      const best = pickBest(results);
      if (!best) {
        return {
          ok: false,
          reason: 'no-result',
          message: 'Couldn’t read anything from this page.',
        };
      }
      return { ok: true, result: best };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cannot access|cannot be scripted|permission/i.test(message)) {
        return {
          ok: false,
          reason: 'restricted',
          message:
            'Rolestash doesn’t have access to this page. Click the toolbar icon while viewing the job.',
        };
      }
      return { ok: false, reason: 'error', message };
    }
  }
}

/** Prefer job pages, then higher confidence, then the top frame. */
export function pickBest(results: readonly ExtractionResult[]): ExtractionResult | undefined {
  return [...results].sort(
    (a, b) =>
      Number(b.isJobPage) - Number(a.isJobPage) ||
      b.confidence - a.confidence ||
      Number(a.fromFrame ?? false) - Number(b.fromFrame ?? false),
  )[0];
}
