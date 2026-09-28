import { extractJob } from '@/extraction';

/**
 * Injected on demand into the page (and its frames) via
 * chrome.scripting.executeScript({ files: ['/extractor.js'] }).
 * Never registered as a persistent content script — see ADR-0004.
 *
 * The return value becomes the injection result, so it must be
 * structured-clone serialisable (ExtractionResult is plain data).
 */
export default defineUnlistedScript(() => extractJob(document, location.href));
