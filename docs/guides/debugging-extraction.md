# Debugging a bad capture

1. **Reproduce in the popup.** Open the posting, click the icon, expand
   **Extraction details**. For each field you'll see the strategy
   (`json-ld`, `microdata`, `adapter:selector`, `adapter:title-pattern`,
   `adapter:url`, `adapter:custom`, `meta`, `heuristic`) and its confidence.
2. **Read the table:**
   - Wrong site id (`generic` on a known board) → the adapter's `hosts` don't match.
   - Field from `meta`/`heuristic` on a supported site → the adapter selectors
     no longer match. Inspect the element and update the selector.
   - Wrong value from `json-ld` → the site publishes bad structured data; add an
     adapter selector with confidence above 0.95 is **not** allowed (it must stay
     below JSON-LD), so instead post-process in the adapter's `extract()` or in
     `extract.ts` if the problem is general.
   - Nothing at all / "Couldn't read this page" → restricted page (Chrome Web
     Store, `chrome://`), or the content is in a cross-origin iframe.
3. **Copy report** puts the full `ExtractionResult` JSON on the clipboard —
   attach it to the issue.
4. **Page HTML** downloads the rendered DOM so you can turn the case into a
   fixture (scrub personal data first). Then follow
   [adding a site adapter](adding-a-site-adapter.md) from step 4.

## Checking a stored job

Every saved job keeps `extraction.provenance` (`"title": "json-ld@0.95"`) and
`extraction.extractorVersion`. In the board's console:

```js
Object.values(await chrome.storage.local.get(null)).filter((v) => v.extraction);
```

## Common causes

| Symptom                              | Likely cause                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Company is the job board's name      | `og:site_name` leaked through; extend `looksLikeSiteName`                                             |
| Title has extra words ("- job post") | Hidden accessibility text; add to `cleanTitle`                                                        |
| Salary missing                       | Text has no currency/`k`/period signal, or selector points at a pill list without an amount           |
| Duplicate not detected               | Adapter lacks `canonicalUrl` / `externalId` for that URL shape                                        |
| Wrong posting on a search page       | Multiple JSON-LD postings; confidence drops to 0.6 — adapter selectors for the detail pane should win |
