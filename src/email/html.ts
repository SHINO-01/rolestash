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

/**
 * Where a mail client starts the quoted earlier message. Everything from the
 * first of these on is history, not this email.
 */
const QUOTE_START =
  /<(?:div|blockquote)\b[^>]*(?:class=["'][^"']*\b(?:gmail_quote|gmail_attr|yahoo_quoted|moz-cite-prefix)\b|id=["'](?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)["']|type=["']cite["'])[^>]*>/i;

const DROP_ELEMENTS =
  /<(script|style|head|title|template|noscript|svg|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_TAGS =
  /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|tbody|thead|tfoot|tr|ul)$/;

export function htmlToText(html: string, keepQuoted = false): HtmlText {
  let source = html;
  if (!keepQuoted) {
    const quote = QUOTE_START.exec(source);
    if (quote) source = source.slice(0, quote.index);
  }
  source = source.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_ELEMENTS, ' ');

  const out: string[] = [];
  const links: EmailLink[] = [];
  let anchor: { href: string; start: number } | undefined;

  const tag = /<(\/?)([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let last = 0;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    out.push(decodeHtmlEntities(source.slice(last, m.index)).replace(/\s+/g, ' '));
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toLowerCase();
    if (name === 'br') out.push('\n');
    else if (name === 'li' && !closing) out.push('\n• ');
    else if (name === 'td' || name === 'th') out.push(closing ? ' ' : '');
    else if (BLOCK_TAGS.test(name)) out.push('\n');
    else if (name === 'a') {
      if (!closing) {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] ?? '');
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
    found.push({ href: m[0].replace(/[.,;:!?]+$/, ''), text: '' });
  }
  return found;
}
