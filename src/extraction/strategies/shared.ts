import type { ExtractedFields, ExtractionContext, StrategyId, StrategyOutput } from '../types';
import { cleanText } from '../normalize/text';

/** Adds a field to a strategy output if the value is meaningful. */
export function put(
  out: StrategyOutput,
  key: keyof ExtractedFields,
  value: unknown,
  confidence: number,
  strategy: StrategyId,
): void {
  if (!isMeaningful(value)) return;
  (out as Record<string, unknown>)[key] = { value, confidence, strategy };
}

export function isMeaningful(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function defaultCurrencyFor(ctx: ExtractionContext): string | undefined {
  const c = ctx.adapter?.defaultCurrency;
  return typeof c === 'function' ? c(ctx.url) : c;
}

/**
 * Selector syntax: a CSS selector, optionally suffixed with `@attr` to read
 * an attribute instead of text (e.g. `img.logo@alt`, `meta[name=x]@content`).
 */
export function parseSelector(selector: string): { css: string; attr?: string } {
  const m = /^(.*\S)@([a-z][\w-]*)$/i.exec(selector);
  // Guard against CSS like `a[href*="@"]` — only treat as attr when the part before is a valid selector end.
  if (m?.[1] && m[2] && !m[1].endsWith('[') && !/["']$/.test(m[1]))
    return { css: m[1], attr: m[2] };
  return { css: selector };
}

function safeQueryAll(doc: ParentNode, css: string): Element[] {
  try {
    return [...doc.querySelectorAll(css)];
  } catch {
    return [];
  }
}

export interface SelectorHit {
  selector: string;
  elements: Element[];
  text: string;
}

/**
 * Returns the first selector that yields non-empty content.
 * `all` concatenates every matching element (for chip/pill lists).
 */
export function firstMatch(
  doc: ParentNode,
  selectors: readonly string[],
  all = false,
): SelectorHit | undefined {
  for (const selector of selectors) {
    const { css, attr } = parseSelector(selector);
    const elements = safeQueryAll(doc, css);
    const values = (all ? elements : elements.slice(0, 1)).map((el) =>
      cleanText(attr ? el.getAttribute(attr) : el.textContent),
    );
    const text = values.filter(Boolean).join(' · ');
    if (text) return { selector, elements, text };
  }
  return undefined;
}

export function metaContent(doc: Document, ...names: string[]): string | undefined {
  for (const name of names) {
    const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    const content = cleanText(el?.getAttribute('content'));
    if (content) return content;
  }
  return undefined;
}
