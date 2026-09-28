import { browser } from 'wxt/browser';
import type { ExtractionResult } from '@/extraction';
import type { ExtractorRunner, PageSnapshot } from '@/services/ports';

/**
 * Injects the bundled extractor (src/entrypoints/extractor.ts) into a tab.
 * Requires either `activeTab` (granted by a user gesture) or host permission.
 */
const EXTRACTOR_FILE = '/extractor.js';

export class ScriptingExtractorRunner implements ExtractorRunner {
  async run(tabId: number): Promise<ExtractionResult[]> {
    let injections;
    try {
      // All frames: some ATSs (iCIMS) render the posting in a same-origin iframe.
      injections = await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [EXTRACTOR_FILE],
      });
    } catch (error) {
      // A cross-origin frame without access can fail the whole call; retry top frame only.
      if (isPermissionError(error)) throw error;
      injections = await browser.scripting.executeScript({
        target: { tabId },
        files: [EXTRACTOR_FILE],
      });
    }
    const results: ExtractionResult[] = [];
    for (const injection of injections) {
      const result = injection.result as ExtractionResult | undefined;
      if (result && typeof result === 'object')
        results.push({ ...result, fromFrame: injection.frameId !== 0 });
    }
    return results;
  }

  async snapshot(tabId: number): Promise<PageSnapshot> {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: location.href,
        title: document.title,
        html: `<!doctype html>\n${document.documentElement.outerHTML}`,
      }),
    });
    const result = injection?.result;
    if (!result) throw new Error('Could not read the page.');
    return result;
  }
}

function isPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot access|cannot be scripted|permission|chrome:\/\/|extensions gallery/i.test(
    message,
  );
}
