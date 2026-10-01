/**
 * Cleaning: reduce an email body to the words the sender wrote in *this*
 * message. Quoted history, signatures and legal/unsubscribe footers are
 * removed, so an offer quoted from three emails ago never counts.
 */

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[ \t]+/g, ' ');
}

/** A manually forwarded email: the real sender and subject sit in the body. */
export interface ForwardedHeader {
  from?: string;
  subject?: string;
}

/**
 * If the body is a manual forward ("---------- Forwarded message ---------"),
 * returns the forwarded message's own headers and body; otherwise undefined.
 * Mail-filter forwarding (ADR-0014) keeps the original intact and never
 * matches.
 */
export function unwrapForward(text: string): { header: ForwardedHeader; body: string } | undefined {
  const marker =
    /^[ \t>]*-{3,}\s*Forwarded message\s*-{3,}[ \t]*$|^[ \t]*Begin forwarded message:[ \t]*$/im.exec(
      text,
    );
  if (!marker) return undefined;
  // Only a forward if little was written above the marker.
  if (text.slice(0, marker.index).trim().length > 400) return undefined;
  const after = text.slice(marker.index + marker[0].length).replace(/^\n+/, '');
  const lines = after.split('\n');
  const header: ForwardedHeader = {};
  let i = 0;
  for (; i < lines.length && i < 12; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line) {
      if (Object.keys(header).length) break;
      continue;
    }
    const h = /^(From|Subject|Date|Sent|To|Cc|Reply-To):\s*(.*)$/i.exec(line);
    if (!h) break;
    const key = (h[1] ?? '').toLowerCase();
    if (key === 'from') header.from = h[2];
    if (key === 'subject') header.subject = h[2];
  }
  return { header, body: lines.slice(i).join('\n') };
}

/** Lines that start quoted history in plain-text replies. */
const QUOTE_HEADERS: RegExp[] = [
  // "On Tue, 1 Oct 2026 at 09:12, Sam <sam@x> wrote:" (may wrap onto two lines)
  /^On\b[^\n]{0,200}(?:\n[^\n]{0,200})?\bwrote:[ \t]*$/m,
  /^Le\b[^\n]{0,200}a écrit\s*:[ \t]*$/m,
  /^-{2,}\s*Original Message\s*-{2,}[ \t]*$/im,
  /^_{10,}[ \t]*$/m,
  // Outlook: "From: …" followed by "Sent:"/"Date:" within the next lines.
  /^From:[^\n]+\n(?:[^\n]*\n){0,3}?(?:Sent|Date):[^\n]+$/im,
];

const FOOTER_LINE =
  /unsubscribe|opt[- ]out|manage (?:your )?(?:email )?(?:preferences|notifications|subscriptions)|privacy (?:policy|notice|statement)|terms of (?:use|service)|this (?:e-?mail|message) (?:was|is being) sent|you (?:are|were) receiving this|do not reply|don't reply|no-?reply|please do not respond|©|\(c\) ?\d{4}|all rights reserved|view (?:it )?in (?:your|a) browser|confidential(?:ity)? (?:notice|information)|intended (?:solely |only )?for (?:the )?(?:use of the )?(?:named )?(?:addressee|recipient|individual)|if you (?:have )?received this (?:e-?mail|message) in error|powered by (?:greenhouse|lever|workday|smartrecruiters|ashby|icims)|sent (?:from|via) (?:my )?(?:iphone|ipad|android|outlook|mobile)|get outlook for/i;

/** Removes quoted history, signature and footer lines. */
export function stripNoise(text: string): string {
  let body = text;
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(body);
    if (m) body = body.slice(0, m.index);
  }
  const lines: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (/^--\s*$/.test(line)) break; // RFC 3676 signature delimiter
    if (/^\s*>/.test(line)) continue; // quoted line
    if (FOOTER_LINE.test(line)) continue;
    lines.push(line.trim());
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan't\b/g, 'cannot'],
  [/\bwon't\b/g, 'will not'],
  [/\bshan't\b/g, 'shall not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\b(\w+)'re\b/g, '$1 are'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'],
  [/\bi'm\b/g, 'i am'],
  [/\b(we|you|they|i)'d\b/g, '$1 would'],
  [/\b(it|that|there|here|what)'s\b/g, '$1 is'],
  [/\blet's\b/g, 'let us'],
];

/** Lower-case and expand contractions, so rules see one spelling. */
export function canonicalWords(sentence: string): string {
  let s = sentence.toLowerCase();
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

/** Splits cleaned text into sentences (also on line breaks). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    for (const part of block.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/)) {
      const s = part.trim();
      if (/[a-z]/i.test(s)) out.push(s);
    }
  }
  return out;
}
