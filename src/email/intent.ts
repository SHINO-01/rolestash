import { canonicalWords, splitSentences } from './clean';
import type { StatusIntent } from './constants';

/**
 * Sentence-level intent scoring (ADR-0014 §5.4). Each phrase rule adds
 * weighted evidence for one intent. The subject and opening sentences weigh
 * more; negated, conditional ("if you are unsuccessful…") and hedged
 * ("we may…") mentions count for little or nothing; known traps are removed
 * before scoring.
 */

interface PhraseRule {
  intent: StatusIntent;
  re: RegExp;
  weight: number;
  label: string;
}

const rule = (intent: StatusIntent, weight: number, label: string, re: RegExp): PhraseRule => ({
  intent,
  weight,
  label,
  re,
});

const ROLE = '(?:position|role|job|opportunity|vacancy|opening)';
/** What follows "offer" when it isn't a job offer: "offer you an interview". */
const NOT_AN_OFFER =
  ' (?:you )?(?:an? |the |your )?(?:\\w+ )?(?:interview|chat|call|conversation|meeting|assessment|opportunity to)';
const PEOPLE = '(?:candidates?|applicants?|individuals?|people|profiles?)';

export const PHRASE_RULES: PhraseRule[] = [
  // received
  rule(
    'received',
    2.5,
    'thanks for applying',
    /\bthanks?(?: you)? (?:so much |very much )?for (?:applying|your (?:recent )?application|submitting your application|your interest in)/,
  ),
  rule(
    'received',
    3,
    'application received',
    /\b(?:we have|we) (?:successfully )?received your (?:job )?application|your application (?:has been|was|is) (?:successfully )?(?:received|submitted|sent)|application (?:received|confirmation|submitted|acknowledg(?:e)?ment)\b/,
  ),
  rule(
    'received',
    3,
    'confirms receipt',
    /\b(?:confirm(?:s|ing)?|acknowledg(?:e|es|ing)) (?:the )?(?:receipt of|that we have received) your/,
  ),
  rule(
    'received',
    1.5,
    'reviewing your application',
    /\b(?:will|are|is) (?:now |currently )?(?:be )?(?:review(?:ing)?|assess(?:ing)?|consider(?:ing)?) (?:your|all) (?:application|resume|cv|profile|applications)/,
  ),
  rule(
    'received',
    1.5,
    'only shortlisted contacted',
    /\bonly (?:shortlisted|successful|selected) (?:candidates|applicants) will be (?:contacted|notified)/,
  ),
  rule(
    'received',
    1,
    'high volume',
    /\b(?:high|large) (?:volume|number) of (?:applications|applicants)/,
  ),

  // assessment
  rule(
    'assessment',
    3,
    'assessment named',
    /\b(?:coding|technical|online|skills?|aptitude|cognitive|psychometric|personality|numerical|verbal|take[- ]home|video) (?:challenge|assessment|test|exercise|assignment|questionnaire)/,
  ),
  rule(
    'assessment',
    3,
    'complete the assessment',
    /\b(?:complete|take|start|begin|attempt|sit) (?:the|an|our|this|your|a|a short) (?:\w+ )?(?:assessment|test|challenge|exercise|assignment)/,
  ),
  rule(
    'assessment',
    2,
    'assessment invitation',
    /\b(?:assessment|test|challenge) (?:link|invitation|invite)\b/,
  ),
  rule(
    'assessment',
    2,
    'time to complete',
    /\byou (?:will )?have \d+ (?:hours?|days?) to complete/,
  ),

  // interview
  rule(
    'interview',
    4,
    'invited to interview',
    /\b(?:invite|invitation|invited|inviting|invites) (?:you )?(?:to|for) (?:an? |the |your |our )?(?:\w+ ){0,3}(?:interview|conversation|chat|call|meeting|discussion)/,
  ),
  rule(
    'interview',
    4,
    'interview invitation',
    /\binterview (?:invitation|invite|request|confirmation|confirmed|scheduled|details|booked)\b/,
  ),
  rule(
    'interview',
    3,
    'arrange an interview',
    /\b(?:schedule|arrange|book|set up|organi[sz]e|coordinate) (?:a|an|your|the|some)? ?(?:\w+ )?(?:interview|call|chat|meeting|time to (?:chat|speak|talk|meet))/,
  ),
  rule(
    'interview',
    2.5,
    'would like to speak',
    /\b(?:would|like|love|keen) to (?:speak|talk|chat|meet) (?:with you|to you|further)/,
  ),
  rule(
    'interview',
    4,
    'interview scheduled',
    /\b(?:your|the) (?:\w+ )?(?:interview|phone screen|video call) (?:is|has been|will be|was) (?:now )?(?:scheduled|confirmed|booked|set|rescheduled)/,
  ),
  rule(
    'interview',
    2.5,
    'interview round',
    /\b(?:phone|video|initial|first|second|final|technical|panel|on-?site|in-person|recruiter|hiring manager) (?:screen(?:ing)? (?:call|interview)|interview|round|screen)\b/,
  ),
  rule(
    'interview',
    2.5,
    'next stage',
    /\b(?:move|moving|progress|progressing|advance|advancing|proceed|proceeding|invite you) (?:you |your application )?(?:forward |through )?to the next (?:stage|round|step)/,
  ),
  rule(
    'interview',
    2.5,
    'availability',
    /\b(?:let us know|share|send|provide|confirm) (?:us )?your availability|what (?:is|are) your availability|when (?:are|would) you be (?:available|free)|times? that (?:suits?|works?) (?:you|best)/,
  ),
  rule(
    'interview',
    1.5,
    'looking forward to speaking',
    /\blooking forward to (?:speaking|meeting|chatting|talking) (?:with|to) you/,
  ),
  rule(
    'interview',
    4,
    'offered an interview',
    /\boffer(?:s|ed|ing)? (?:you )?(?:an? |the |your )?(?:\w+ )?(?:interview|chat|call|conversation|meeting)\b/,
  ),
  rule(
    'interview',
    3,
    'reschedule interview',
    /\breschedul(?:e|ed|ing) (?:your|the|our) (?:\w+ )?interview/,
  ),

  // rejected
  rule(
    'rejected',
    5,
    'not moving forward',
    /\b(?:not|no longer) (?:be )?(?:moving|move|going|proceeding|proceed|progressing|progress|taking|take|able to (?:move|take|proceed|progress)) (?:your application |your candidacy |you )?(?:forward|ahead|further)/,
  ),
  rule(
    'rejected',
    5,
    'decided not to proceed',
    /\bdecided (?:not to (?:proceed|progress|move forward|continue|pursue|take)|to (?:proceed|move forward|go|continue|pursue|progress) with (?:other|another|a different|alternative) (?:candidates?|applicants?|direction|profiles?))/,
  ),
  rule(
    'rejected',
    4.5,
    'other candidates',
    new RegExp(
      `\\b(?:proceed|move forward|go ahead|continue|progress) with (?:other|another|alternative) ${PEOPLE}`,
    ),
  ),
  rule(
    'rejected',
    4.5,
    'closer matches',
    new RegExp(
      `\\b(?:other|another) ${PEOPLE} (?:whose|who|with) (?:experience|skills|background|profiles?|qualifications)? ?(?:more closely|better|more|is a closer|are a closer)`,
    ),
  ),
  rule(
    'rejected',
    6,
    'unable to offer',
    new RegExp(
      `\\b(?:unable|not able|cannot|could not|are not in a position) to offer you (?:a |the |an )?(?:\\w+ )?(?:${ROLE}|interview|employment|place)`,
    ),
  ),
  rule(
    'rejected',
    4,
    'position filled',
    new RegExp(`\\b${ROLE} (?:has|have) (?:now )?been filled`),
  ),
  rule(
    'rejected',
    4.5,
    'unsuccessful',
    /\b(?:unsuccessful|not (?:been )?successful|(?:have|has) not been (?:selected|shortlisted|progressed)|were not selected|was not selected|not (?:been )?shortlisted)\b/,
  ),
  rule('rejected', 4, 'regret to inform', /\bregret to (?:inform|advise|let you know|tell you)/),
  rule(
    'rejected',
    4.5,
    'not progressed',
    /\b(?:your application|you) (?:has|have|will) not (?:progress|progressed|been progressed|be progressing|be proceeding)/,
  ),
  rule('rejected', 1, 'unfortunately', /\bunfortunately\b/),
  rule(
    'rejected',
    1,
    'kept on file',
    /\b(?:keep|retain|hold) your (?:details|resume|cv|application|profile) on (?:file|record)/,
  ),
  rule(
    'rejected',
    1.5,
    'best wishes for the search',
    /\bwish(?:ing)? you (?:the (?:very )?best|every success|all the best|success|luck|well) (?:in|with|for) (?:your|the) (?:job )?(?:search|future|career|endeavou?rs)/,
  ),
  rule(
    'rejected',
    3,
    'role cancelled',
    new RegExp(
      `\\b${ROLE} (?:has been|was|is|is now|has now been) (?:cancell?ed|withdrawn|put on hold|on hold|closed)`,
    ),
  ),

  // offer
  rule(
    'offer',
    5,
    'pleased to offer',
    // …but "pleased to offer you an interview" is an interview.
    new RegExp(
      `\\b(?:pleased|delighted|happy|excited|thrilled) to (?:extend |make |present |formally )?(?:you )?(?:an? |the |this )?(?:formal |verbal |written |conditional )?offer(?!${NOT_AN_OFFER})`,
    ),
  ),
  rule(
    'offer',
    4,
    'offer you the position',
    new RegExp(
      `\\boffer you (?:the|a|this) (?:\\w+ ){0,4}?${ROLE}(?! to (?:interview|meet|discuss))`,
    ),
  ),
  rule(
    'offer',
    3,
    'offer letter',
    /\boffer (?:letter|of employment|package|details|pack)\b|\bletter of offer\b/,
  ),
  rule(
    'offer',
    1.5,
    'compensation package',
    /\b(?:compensation|remuneration|salary) (?:package|details)\b/,
  ),
  rule(
    'offer',
    2.5,
    'sign the offer',
    /\b(?:sign|accept|review|countersign) (?:and return )?(?:the|your) (?:offer|contract|employment agreement)/,
  ),
  rule('offer', 2, 'welcome to the team', /\bwelcome (?:to the team|aboard|on board)\b/),
  rule(
    'offer',
    3.5,
    'move forward with an offer',
    /\b(?:would like|want|plan|intend|going) to (?:move forward with|extend|make) (?:you )?an offer/,
  ),
];

/** Intents whose mentions are discounted by negation, conditions and hedges. */
const POSITIVE: ReadonlySet<StatusIntent> = new Set([
  'received',
  'assessment',
  'interview',
  'offer',
]);
const PROGRESS: ReadonlySet<StatusIntent> = new Set([
  'assessment',
  'interview',
  'rejected',
  'offer',
]);

/**
 * Trap phrases, removed before scoring. Each would otherwise look like
 * evidence for the wrong intent.
 */
const TRAPS: { re: RegExp; label: string; received?: number }[] = [
  {
    label: 'cannot reply to everyone',
    received: 1.5,
    re: /\b(?:unfortunately,? )?(?:(?:due to|because of|given) (?:the )?(?:very )?(?:high|large|overwhelming)? ?(?:volume|number) of (?:applications|applicants|responses)[^.]*?)?(?:we|i) (?:are|am)? ?(?:unable|not able|cannot|will not be able|may not be able|not always able) to (?:reply|respond|provide (?:individual |personal )?feedback|get back|contact)(?: to)?(?: (?:every|each|all|individual|everyone|everybody|unsuccessful)\w*)?[^.]*/g,
  },
  {
    label: 'not an offer of employment',
    re: /\b(?:is|does) not (?:an?|constitute an?|represent an?) (?:offer|contract)(?: of employment)?|\bnot an offer of employment|\bno offer of employment/g,
  },
  {
    label: 'we offer (benefits)',
    re: /\b(?:we|they|company|it|employer) offers? (?:a |an )?(?:flexible|competitive|great|range|generous|hybrid|remote|attractive|excellent|variety|plenty|career)[^.]*/g,
  },
  {
    label: 'courtesy condition',
    re: /\bif you (?:have|would like|need|require|wish|want|experience)\b[^.;]*|\bplease do not hesitate[^.;]*|\bfeel free to[^.;]*/g,
  },
  {
    label: 'unsubscribe',
    re: /\bif you (?:no longer )?(?:wish|want) to (?:stop|unsubscribe)[^.]*/g,
  },
];

const NEGATION = /\b(?:not|no|never|unable|cannot|without|neither|nor|none)\b/;
const NEGATION_BREAK = /\b(?:but|however|although|though|yet|instead)\b/;
const CONDITIONAL =
  /\b(?:if|should you|should your|in the event|unless|provided that|whether|once you|once we|in case)\b/;
const HEDGE =
  /\b(?:may|might|possibly|potentially|perhaps|future (?:roles?|opportunit\w*|vacanc\w*|positions?|openings?)|in (?:the )?future|from time to time|be in touch)\b|\bcould\b(?! not)/;

export interface IntentScores {
  scores: Record<StatusIntent, number>;
  reasons: string[];
}

function negated(before: string): boolean {
  const words = before.split(' ').slice(-6).join(' ');
  const neg = NEGATION.exec(words);
  if (!neg) return false;
  return !NEGATION_BREAK.test(words.slice(neg.index));
}

export function emptyScores(): Record<StatusIntent, number> {
  return { received: 0, assessment: 0, interview: 0, rejected: 0, offer: 0 };
}

/**
 * Scores the subject and cleaned body. Each rule counts once, at the
 * sentence where it weighs most, so a repeated phrase can't inflate a score.
 */
export function scoreIntents(subject: string, body: string): IntentScores {
  const scores = emptyScores();
  const reasons: string[] = [];
  const best = new Map<PhraseRule, number>();

  const units: { text: string; weight: number }[] = [
    // A reply's subject repeats an old topic ("Re: Offer of employment"), so it counts for little.
    {
      text: subject.replace(/^(?:(?:re|fw|fwd|aw)\s*:\s*)+/i, ''),
      weight: /^\s*re\s*:/i.test(subject) ? 0.5 : 2,
    },
    ...splitSentences(body).map((text, i) => ({ text, weight: i < 3 ? 1.5 : 1 })),
  ];

  let trapReceived = 0;
  for (const unit of units) {
    let s = canonicalWords(unit.text);
    for (const trap of TRAPS) {
      s = s.replace(trap.re, () => {
        if (trap.received) trapReceived = Math.max(trapReceived, trap.received);
        if (!reasons.includes(`trap: ${trap.label}`) && trap.label !== 'courtesy condition')
          reasons.push(`trap: ${trap.label}`);
        return ' ';
      });
    }
    const conditional = CONDITIONAL.test(s);
    const hedged = HEDGE.test(s);
    for (const r of PHRASE_RULES) {
      const m = r.re.exec(s);
      if (!m) continue;
      let factor = unit.weight;
      if (POSITIVE.has(r.intent) && negated(s.slice(0, m.index))) factor = 0;
      if (PROGRESS.has(r.intent) && conditional) factor = 0;
      if (PROGRESS.has(r.intent) && hedged) factor *= r.intent === 'rejected' ? 0.5 : 0.35;
      const value = r.weight * factor;
      if (value > (best.get(r) ?? 0)) best.set(r, value);
    }
  }

  for (const [r, value] of best) {
    scores[r.intent] += value;
    reasons.push(`${r.intent}: ${r.label} (+${value.toFixed(1)})`);
  }
  if (trapReceived) scores.received += trapReceived;
  return { scores, reasons };
}

/**
 * Minimum scores. A wrong "Rejected" is the costliest mistake, so rejected
 * and offer need much stronger evidence than received (ADR-0014 §5.5).
 */
export const THRESHOLDS: Record<StatusIntent, { suggest: number; apply: number }> = {
  received: { suggest: 2, apply: 3 },
  assessment: { suggest: 2.5, apply: 4.5 },
  interview: { suggest: 2.5, apply: 4.5 },
  rejected: { suggest: 3, apply: 6 },
  offer: { suggest: 3, apply: 7 },
};

/** The winner must beat the runner-up by this much to be applied (or suggested). */
export const MARGIN = { apply: 2.5, suggest: 1 };
