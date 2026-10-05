/**
 * HTML → plain text without a DOM. The Email Worker runs on Cloudflare
 * Workers, which have no DOMParser, so this is a small tag tokenizer. It only
 * ever reads text and link targets; nothing is rendered or fetched.
 */

export interface EmailLink {
  href: string;
  /** The anchor text, trimmed (empty for bare URLs found in text). */
  text: string;
}

export interface HtmlText {
  text: string;
  links: EmailLink[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  zwnj: '',
  zwj: '',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// The HTML comes from any sender, so the scans below take linear time: an
// unclosed tag, comment or element is found out once, not rescanned from every
// later `<` as the single regexes they replace did (CWE-1333). They give the
// same results as those regexes.

/**
 * Where a mail client starts the quoted earlier message: the first `<div>` or
 * `<blockquote>` tag that carries one of the markers below before its first
 * `>`. A class value may itself hold `>`, so a class marker needs a `>` only
 * somewhere after the class name. Everything from that tag on is history.
 */
const QUOTE_OPEN = /<(?:div|blockquote)\b/gi;
const QUOTE_MARKER =
  /(class=["'])|id=["'](?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)["']|type=["']cite["']/gi;
const QUOTE_CLASS = /\b(?:gmail_quote|gmail_attr|yahoo_quoted|moz-cite-prefix)\b/i;

function quoteStart(html: string): number {
  const open = new RegExp(QUOTE_OPEN);
  const marker = new RegExp(QUOTE_MARKER);
  const quoteChar = /["']/g;
  const lastGt = html.lastIndexOf('>');
  // The first complete marker at or after `from`, or Infinity.
  const nextMarker = (from: number): number => {
    marker.lastIndex = Math.max(marker.lastIndex, from);
    for (let m = marker.exec(html); m; m = marker.exec(html)) {
      const classAttr = m[1];
      if (!classAttr) return m.index;
      const value = m.index + classAttr.length;
      quoteChar.lastIndex = value;
      const valueEnd = quoteChar.exec(html)?.index ?? html.length;
      const name = QUOTE_CLASS.exec(html.slice(value, valueEnd));
      if (name && lastGt >= value + name.index + name[0].length) return m.index;
    }
    return Infinity;
  };
  let gt = -1;
  let next = -1;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const from = m.index + m[0].length;
    if (gt < from) gt = html.indexOf('>', from);
    if (gt < 0) return -1;
    if (next < from) next = nextMarker(from);
    if (next === Infinity) return -1;
    // The marker must sit inside this tag: before its first `>`.
    if (next < gt) return m.index;
  }
  return -1;
}

/** Removes `<!-- … -->` comments; one that never closes stays, as before. */
function stripComments(html: string): string {
  let out = '';
  let last = 0;
  for (let start = html.indexOf('<!--'); start >= 0; start = html.indexOf('<!--', last)) {
    const end = html.indexOf('-->', start + 4);
    if (end < 0) break; // no later comment can close either
    out += html.slice(last, start);
    last = end + 3;
  }
  return out + html.slice(last);
}

/**
 * Replaces each of these elements, from its opening tag to the first matching
 * closing tag, with a space. One that never closes stays, as before.
 */
const DROP_OPEN = /<(script|style|head|title|template|noscript|svg|xml)\b/gi;

function dropElements(html: string): string {
  const open = new RegExp(DROP_OPEN);
  // Per element name: the first closing tag at or after `from` (at -1: none).
  const closes = new Map<string, { from: number; at: number; end: number }>();
  const closing = (name: string, from: number): { at: number; end: number } => {
    const known = closes.get(name);
    if (known && from >= known.from && (known.at < 0 || from <= known.at)) return known;
    const re = new RegExp(`</${name}\\s*>`, 'gi');
    re.lastIndex = from;
    const m = re.exec(html);
    const found = { from, at: m ? m.index : -1, end: m ? m.index + m[0].length : -1 };
    closes.set(name, found);
    return found;
  };
  let out = '';
  let last = 0;
  let gt = -1;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const afterName = m.index + m[0].length;
    if (gt < afterName) gt = html.indexOf('>', afterName);
    if (gt < 0) break; // no later element can open either
    const close = closing((m[1] ?? '').toLowerCase(), gt + 1);
    if (close.at < 0) continue;
    out += `${html.slice(last, m.index)} `;
    last = open.lastIndex = close.end;
  }
  return out + html.slice(last);
}

/**
 * Where the tag whose attributes start at `from` ends (its `>`), or -1. A
 * quoted value may hold `>`; an unclosed quote or a missing `>` ends nothing,
 * and every place such a scan passed outside quotes is marked `dead`, so a
 * later scan that reaches one stops there.
 */
function tagEnd(html: string, from: number, dead: Uint8Array): number {
  const path: number[] = [];
  for (let i = from; i < html.length && !dead[i];) {
    const c = html[i];
    if (c === '>') return i;
    path.push(i);
    if (c === '"' || c === "'") {
      const close = html.indexOf(c, i + 1);
      if (close < 0) break;
      i = close + 1;
    } else i++;
  }
  for (const i of path) dead[i] = 1;
  return -1;
}

const BLOCK_TAGS =
  /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|tbody|thead|tfoot|tr|ul)$/;

export function htmlToText(html: string, keepQuoted = false): HtmlText {
  let source = html;
  if (!keepQuoted) {
    const quote = quoteStart(source);
    if (quote >= 0) source = source.slice(0, quote);
  }
  source = dropElements(stripComments(source));

  const out: string[] = [];
  const links: EmailLink[] = [];
  let anchor: { href: string; start: number } | undefined;

  const tag = /<(\/?)([a-z][a-z0-9]*)\b/gi;
  const dead = new Uint8Array(source.length);
  let last = 0;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const attrsStart = m.index + m[0].length;
    const end = tagEnd(source, attrsStart, dead);
    if (end < 0) continue;
    tag.lastIndex = end + 1;
    const attrs = source.slice(attrsStart, end);
    out.push(decodeHtmlEntities(source.slice(last, m.index)).replace(/\s+/g, ' '));
    last = end + 1;
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toLowerCase();
    if (name === 'br') out.push('\n');
    else if (name === 'li' && !closing) out.push('\n• ');
    else if (name === 'td' || name === 'th') out.push(closing ? ' ' : '');
    else if (BLOCK_TAGS.test(name)) out.push('\n');
    else if (name === 'a') {
      if (!closing) {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const value = decodeHtmlEntities((href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim());
        anchor = value ? { href: value, start: out.length } : undefined;
      } else if (anchor) {
        const text = out.slice(anchor.start).join('').replace(/\s+/g, ' ').trim();
        links.push({ href: anchor.href, text });
        anchor = undefined;
      }
    }
  }
  out.push(decodeHtmlEntities(source.slice(last)).replace(/\s+/g, ' '));

  const text = out
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, links: links.filter((l) => /^https?:\/\//i.test(l.href)) };
}

/** Bare http(s) URLs written in plain text. */
export function linksInText(text: string): EmailLink[] {
  const found: EmailLink[] = [];
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) {
    // Trailing punctuation; the lookbehind tries each run once (linear time).
    found.push({ href: m[0].replace(/(?<![.,;:!?])[.,;:!?]+$/, ''), text: '' });
  }
  return found;
}
