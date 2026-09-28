/**
 * Text helpers. All HTML parsing goes through DOMParser, which produces an
 * inert document: scripts never run and resources never load. We only ever
 * read `textContent` from it — no posting HTML is stored or rendered
 * (ADR-0005).
 */

const MAX_DESCRIPTION_CHARS = 60_000;

export function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITY_PATTERN = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;

/** Decodes HTML entities in a plain string ("R&amp;D" → "R&D"). */
export function decodeEntities(value: string): string {
  if (!ENTITY_PATTERN.test(value)) return value;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${value}`, 'text/html');
  return doc.body.textContent;
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'BUTTON',
  'IFRAME',
  'OBJECT',
  'CANVAS',
  'INPUT',
  'SELECT',
  'TEXTAREA',
]);
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'HEADER',
  'HR',
  'MAIN',
  'NAV',
  'OL',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);
const PARAGRAPH_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/**
 * Converts an element subtree to readable plain text, keeping paragraph
 * breaks and list bullets so descriptions stay scannable.
 */
export function elementToText(root: Node): string {
  const out: string[] = [];

  const walk = (node: Node): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      out.push((node.textContent ?? '').replace(/[\s\u00a0]+/g, ' '));
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (
      SKIP_TAGS.has(tag) ||
      el.getAttribute('aria-hidden') === 'true' ||
      el.hasAttribute('hidden')
    )
      return;

    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (tag === 'LI') {
      out.push('\n• ');
      el.childNodes.forEach(walk);
      out.push('\n');
      return;
    }
    if (tag === 'TD' || tag === 'TH') {
      el.childNodes.forEach(walk);
      out.push('  ');
      return;
    }
    const isParagraph = PARAGRAPH_TAGS.has(tag);
    const isBlock = isParagraph || BLOCK_TAGS.has(tag);
    if (isBlock) out.push(isParagraph ? '\n\n' : '\n');
    el.childNodes.forEach(walk);
    if (isBlock) out.push(isParagraph ? '\n\n' : '\n');
  };

  walk(root);
  return tidyMultiline(out.join(''));
}

export function tidyMultiline(text: string): string {
  const tidy = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n•\s*\n/g, '\n') // empty bullets
    .replace(/(•[^\n]*)\n{2,}(?=•)/g, '$1\n') // consecutive bullets stay tight
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidy.length > MAX_DESCRIPTION_CHARS ? `${tidy.slice(0, MAX_DESCRIPTION_CHARS)}…` : tidy;
}

/**
 * Converts an HTML fragment (e.g. a JSON-LD `description`) to plain text.
 * Handles the common double-encoded case (`&lt;p&gt;…`).
 */
export function htmlToText(html: string): string {
  let source = html;
  if (!/<[a-z!/]/i.test(source) && /&lt;[a-z/]/i.test(source)) source = decodeEntities(source);
  if (!/<[a-z!/]/i.test(source)) return tidyMultiline(decodeEntities(source));
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${source}`, 'text/html');
  return elementToText(doc.body);
}

export function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** "acme-corp_au" → "Acme Corp Au" */
export function slugToName(slug: string): string {
  return titleCase(
    decodeURIComponent(slug)
      .replace(/[-_+.]+/g, ' ')
      .trim(),
  );
}
