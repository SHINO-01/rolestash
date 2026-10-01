import { detectAts, readTemplate } from './ats';
import { normalizeText, stripNoise, unwrapForward } from './clean';
import { htmlToText, linksInText, type EmailLink } from './html';
import { parseCalendar } from './ics';
import { emptyScores, MARGIN, scoreIntents, THRESHOLDS } from './intent';
import { classifyLinks } from './links';
import { findDateTime } from './time';
import {
  STATUS_INTENTS,
  type EmailAction,
  type EmailEvent,
  type EmailInput,
  type EmailIntent,
  type Interview,
  type StatusIntent,
} from './types';

/**
 * The email engine: one parsed email in, one `EmailEvent` out. Pure and
 * deterministic; it runs in the Email Worker (no DOM) and in tests.
 *
 * Order (ADR-0014 §5): Gmail verification → structured signals (calendar
 * invites, scheduling and assessment links) → template readers → sentence
 * scoring with asymmetric thresholds.
 */

export interface Sender {
  address: string;
  domain: string;
  name?: string;
}

export function parseSender(from: string): Sender {
  const angle = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  const address = (angle?.[2] ?? from).trim().toLowerCase();
  const name = angle?.[1]?.trim() ? angle[1].trim() : undefined;
  const domain = address.includes('@') ? (address.split('@').pop() ?? '') : '';
  return { address, domain, name };
}

const GMAIL_VERIFIER = 'forwarding-noreply@google.com';

function readVerification(
  subject: string,
  body: string,
  links: readonly EmailLink[],
): EmailEvent['verification'] {
  const code =
    /confirmation code:\s*(\d{6,12})/i.exec(body)?.[1] ?? /\(#(\d{6,12})\)/.exec(subject)?.[1];
  const url = links.find((l) => {
    try {
      const u = new URL(l.href);
      return (
        u.protocol === 'https:' &&
        /(^|\.)(mail-settings\.google\.com|mail\.google\.com)$/.test(u.hostname)
      );
    } catch {
      return false;
    }
  })?.href;
  return { code, url };
}

function toIso(date: string): string {
  const t = new Date(date);
  return Number.isNaN(t.getTime()) ? new Date(0).toISOString() : t.toISOString();
}

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

const LOCATION_LINE = /^(?:location|address|venue|where|place)\s*[:\-–]\s*(.{4,200})$/im;

function decide(scores: Record<StatusIntent, number>): {
  intent: EmailIntent;
  action: EmailAction;
  confidence: number;
} {
  const ranked = [...STATUS_INTENTS].sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0] ?? 'received';
  const best = scores[top];
  const second = scores[ranked[1] ?? 'received'];
  const margin = best - second;
  const t = THRESHOLDS[top];
  const confidence =
    Math.round(Math.min(0.99, (best / (best + second + 1)) * Math.min(1, best / t.apply)) * 100) /
    100;
  if (best >= t.apply && margin >= MARGIN.apply)
    return { intent: top, action: 'apply', confidence };
  if (best >= t.suggest && margin >= MARGIN.suggest)
    return { intent: top, action: 'suggest', confidence };
  return { intent: 'other', action: 'none', confidence: Math.round((1 - confidence) * 100) / 100 };
}

export function analyzeEmail(input: EmailInput): EmailEvent {
  let sender = parseSender(input.from);
  let subject = normalizeText(input.subject).trim();
  const html = input.html ? htmlToText(input.html) : undefined;
  let raw = normalizeText(input.text?.trim() ? input.text : (html?.text ?? ''));

  // A manual forward carries the real sender and subject in its body.
  const forward = unwrapForward(raw);
  if (forward) {
    raw = forward.body;
    if (forward.header.from) sender = parseSender(forward.header.from);
    if (forward.header.subject) subject = forward.header.subject.trim();
  }
  const body = stripNoise(raw);
  const links = [...(html?.links ?? []), ...linksInText(body)];
  const classified = classifyLinks(links);
  const reasons: string[] = [];

  const base = {
    sender: {
      address: cap(sender.address, 320),
      domain: cap(sender.domain, 253),
      name: sender.name ? cap(sender.name, 200) : undefined,
    },
    subject: cap(subject, 500),
    receivedAt: toIso(input.date),
    postingUrls: classified.postings,
    thread: {
      messageId: input.messageId,
      inReplyTo: input.inReplyTo,
      references: (input.references ?? []).slice(-50),
    },
  };

  if (sender.address === GMAIL_VERIFIER) {
    return {
      ...base,
      intent: 'forwarding_verification',
      action: 'none',
      confidence: 1,
      reasons: ['Gmail forwarding confirmation'],
      verification: readVerification(subject, `${raw}\n${html?.text ?? ''}`, links),
    };
  }

  const ats = detectAts(sender.domain, classified.postings);
  const template = readTemplate({
    ats,
    subject,
    body,
    senderName: sender.name,
    postingUrls: classified.postings,
  });
  const hints = {
    ats,
    atsJobId: template.atsJobId,
    companyHint: template.companyHint,
    titleHint: template.titleHint,
  };

  // 1. Structured signals.
  const invite = input.calendar ? parseCalendar(input.calendar) : undefined;
  if (invite?.method === 'CANCEL') {
    return {
      ...base,
      ...hints,
      intent: 'other',
      action: 'none',
      confidence: 0.9,
      reasons: ['calendar: cancelled event'],
    };
  }

  const { scores, reasons: scoreReasons } = template.decided
    ? { scores: emptyScores(), reasons: [] }
    : scoreIntents(subject, body);
  reasons.push(...scoreReasons);
  if (template.reason) reasons.unshift(template.reason);
  if (template.evidence) scores[template.evidence.intent] += template.evidence.weight;

  let decided: StatusIntent | 'other' | undefined = template.decided;
  const isInvite =
    invite?.start && !invite.allDay && ['REQUEST', 'PUBLISH', undefined].includes(invite.method);
  if (!decided && isInvite) {
    decided = 'interview';
    reasons.unshift('calendar invite');
  }
  const rejectedStrongly = scores.rejected >= THRESHOLDS.rejected.apply;
  if (!decided && classified.scheduler && !rejectedStrongly) {
    decided = 'interview';
    reasons.unshift('scheduling link');
  }
  if (!decided && classified.assessment && !rejectedStrongly) {
    decided = 'assessment';
    reasons.unshift('assessment link');
  }
  if (classified.meeting) {
    scores.interview += 2.5;
    reasons.push('interview: meeting link (+2.5)');
  }
  const textDate = findDateTime(body, input.date);
  if (textDate && scores.interview > 0) scores.interview += 1;

  // A receipt never mentions next steps: progress evidence outweighs it.
  const progress = (['assessment', 'interview', 'rejected', 'offer'] as const).some(
    (i) => scores[i] >= THRESHOLDS[i].suggest,
  );
  if (progress) scores.received *= 0.25;

  const outcome = decided
    ? decided === 'other'
      ? { intent: 'other' as const, action: 'none' as const, confidence: 0.95 }
      : { intent: decided, action: 'apply' as const, confidence: 0.95 }
    : decide(scores);

  let interview: Interview | undefined;
  if (outcome.intent === 'interview') {
    const location =
      invite?.location && !/^https?:\/\//i.test(invite.location)
        ? invite.location
        : LOCATION_LINE.exec(body)?.[1]?.trim();
    const meetingUrl =
      [invite?.conferenceUrl, invite?.url, invite?.location, classified.meeting]
        .map((u) =>
          u && /^https?:\/\//i.test(u) ? classifyLinks([{ href: u, text: '' }]).meeting : undefined,
        )
        .find(Boolean) ??
      (invite?.description ? classifyLinks(linksInText(invite.description)).meeting : undefined);
    const schedulingUrl = classified.scheduler;
    if (isInvite && invite.start) {
      interview = {
        start: invite.start,
        end: invite.end,
        floating: invite.floating,
        timeZone: invite.timeZone,
        location: location ? cap(location, 300) : undefined,
        meetingUrl,
        schedulingUrl,
        source: 'calendar',
      };
    } else {
      interview = {
        start: textDate?.start,
        end: textDate?.end,
        floating: textDate?.floating ?? true,
        timeZone: textDate?.timeZone,
        location: location ? cap(location, 300) : undefined,
        meetingUrl,
        schedulingUrl,
        source: 'text',
      };
    }
  }

  return {
    ...base,
    ...hints,
    ...outcome,
    reasons: reasons.slice(0, 20).map((r) => cap(r, 200)),
    interview,
  };
}
