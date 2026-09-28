import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const FIXTURES_DIR = resolve(import.meta.dirname, '../../fixtures');

export function htmlDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function fixtureDoc(relativePath: string): Document {
  return htmlDoc(readFileSync(resolve(FIXTURES_DIR, relativePath), 'utf8'));
}

/** Wraps JSON-LD in a minimal page. */
export function jsonLdDoc(data: unknown, extraHead = ''): Document {
  return htmlDoc(
    `<!doctype html><html><head>${extraHead}<script type="application/ld+json">${
      typeof data === 'string' ? data : JSON.stringify(data)
    }</script></head><body></body></html>`,
  );
}
