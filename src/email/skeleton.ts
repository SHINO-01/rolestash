import { splitSentences } from './clean';

/**
 * Template skeletons (ADR-0014 §6). Two emails from the same template, sent
 * to different people about different jobs, give the same skeleton:
 * anything personal or specific (names, companies, titles, numbers, dates,
 * links, addresses) becomes a placeholder, and only the template's own
 * lower-case wording remains. Only a SHA-256 of it is ever stored.
 */

/** Fewer template words than this can't identify a template. */
export const MIN_SKELETON_WORDS = 8;
const MAX_CHARS = 4000;
/**
 * A forwarded email's subject comes from its body and has no length limit, and
 * the email-address pattern below is quadratic on a long run of word
 * characters (CWE-1333), so the subject is capped too. Real subjects are far
 * shorter.
 */
const MAX_SUBJECT_CHARS = 1000;

/**
 * Words that start template sentences. A capitalised word is kept only when
 * it's one of these at the start of a sentence; any other capitalised word
 * (a name, company or title, wherever it stands) becomes a placeholder.
 */
const SENTENCE_STARTS = new Set(
  (
    'a about after again all also although an and any apply are as at based before best but by ' +
    'can cheers click congratulations could dear do due during each following for from further ' +
    'given good great happy have hello hey hi however i if in is it just kind kindly let look ' +
    'many may meanwhile more most my next no not now of on once only or our over please ' +
    'pleased regards should since sincerely so sorry still thank thanks that the then there ' +
    'these this thrilled to today unfortunately unless until we welcome what when where whether ' +
    'which while why will with would yes you your'
  ).split(' '),
);

function token(word: string, first: boolean): string | undefined {
  const bare = word.replace(/^[^\p{L}\p{N}<]+|[^\p{L}\p{N}>]+$/gu, '');
  if (!bare) return undefined;
  if (bare === '<url>' || bare === '<email>') return bare;
  if (/\d/.test(bare)) return '<n>';
  const lower = bare.toLowerCase();
  if (/^\p{Lu}/u.test(bare) && !(first && SENTENCE_STARTS.has(lower))) return '<w>';
  return lower;
}

export function skeletonOf(subject: string, body: string): string | undefined {
  const text =
    `${subject.slice(0, MAX_SUBJECT_CHARS).replace(/^(?:(?:re|fw|fwd|aw)\s*:\s*)+/i, '')}\n${body.slice(0, MAX_CHARS)}`
      .replace(/\bhttps?:\/\/\S+/gi, ' <url> ')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' <email> ');
  const out: string[] = [];
  let words = 0;
  for (const sentence of splitSentences(text)) {
    const parts = sentence.split(/\s+/).filter(Boolean);
    parts.forEach((word, i) => {
      const t = token(word, i === 0);
      if (!t) return;
      if (t.startsWith('<')) {
        if (out.at(-1) !== t) out.push(t);
      } else {
        out.push(t);
        words++;
      }
    });
  }
  return words >= MIN_SKELETON_WORDS ? out.join(' ') : undefined;
}
