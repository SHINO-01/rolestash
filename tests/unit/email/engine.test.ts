import { analyzeEmail, parseSender } from '@/email';
import {
  companyFromSenderName,
  detectAts,
  extractHints,
  isPlatformDomain,
  jobIdFromUrl,
} from '@/email/ats';
import {
  canonicalWords,
  normalizeText,
  splitSentences,
  stripNoise,
  unwrapForward,
} from '@/email/clean';
import { decodeHtmlEntities, htmlToText, linksInText } from '@/email/html';
import { parseCalendar } from '@/email/ics';
import { scoreIntents } from '@/email/intent';
import { classifyLink, classifyLinks } from '@/email/links';
import { findDateTime, resolveTimeZone, zonedToInstant, zoneOffsetMinutes } from '@/email/time';
import { findAdapterByHost } from '@/extraction';

describe('htmlToText', () => {
  it('keeps text, breaks and link targets without a DOM', () => {
    const { text, links } = htmlToText(
      `<html><head><title>x</title><style>p{}</style></head><body><p>Hello&nbsp;Sam&#39;s &amp; co</p>
       <ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table>
       <a href='https://example.com/jobs/1?a=1&amp;b=2'>The <b>job</b></a><a href="mailto:x@y.z">mail</a>
       <a>no href</a><script>alert(1)</script><!-- hidden --></body></html>`,
    );
    expect(text).toContain("Hello Sam's & co");
    expect(text).toContain('• One\n• Two');
    expect(text).toContain('A B');
    expect(text).not.toMatch(/alert|hidden|p\{\}/);
    expect(links).toEqual([{ href: 'https://example.com/jobs/1?a=1&b=2', text: 'The job' }]);
  });

  it('drops quoted history blocks unless asked to keep them', () => {
    const html = '<div>New</div><div class="gmail_quote">Old offer</div>';
    expect(htmlToText(html).text).toBe('New');
    expect(htmlToText(html, true).text).toContain('Old offer');
    expect(htmlToText('<p>Hi</p><div id="divRplyFwdMsg">From: x</div>').text).toBe('Hi');
    expect(htmlToText('<p>Hi</p><blockquote type="cite">x</blockquote>').text).toBe('Hi');
  });

  it('decodes entities', () => {
    expect(decodeHtmlEntities('R&amp;D &#x2014; &mdash; &unknown; &#0;')).toBe(
      'R&D — — &unknown; ',
    );
  });

  it('finds bare links in text, without trailing punctuation', () => {
    expect(linksInText('See https://a.example/x. Or (https://b.example/y)')).toEqual([
      { href: 'https://a.example/x', text: '' },
      { href: 'https://b.example/y', text: '' },
    ]);
    expect(linksInText('https://a.example/x?!.,;: https://b.example/a.b.')).toEqual([
      { href: 'https://a.example/x', text: '' },
      { href: 'https://b.example/a.b', text: '' },
    ]);
  });

  it('reads unclosed and odd HTML as before', () => {
    expect(htmlToText('a<!-- x -->b<!-- never closed').text).toBe('ab<!-- never closed');
    expect(htmlToText('<p>a</p><script>x</SCRIPT >b<style>never closed').text).toBe(
      'a\nbnever closed',
    );
    expect(htmlToText('<a href="https://x.example/?q=>">go</a> on').links).toEqual([
      { href: 'https://x.example/?q=>', text: 'go' },
    ]);
    expect(htmlToText('<p>New</p><div class="x>y gmail_quote">Old</div>').text).toBe('New');
    expect(htmlToText('<b>x</b> <i "unclosed>y').text).toBe('x <i "unclosed>y');
  });

  // The HTML part comes from any sender before its inbox token is checked, so
  // unclosed markup must cost linear time, not a rescan from every `<`
  // (CWE-1333). The regexes these replaced took minutes on 2 MB of this.
  it.each([
    ['comments', '<!--'],
    ['dropped elements', '<style>'],
    ['tags', '<a '],
    ['quoted attributes', '<div class="a'],
    ['quote markers', '<blockquote '],
  ])('reads HTML full of unclosed %s in linear time', (_, unit) => {
    const html = unit.repeat(100_000);
    const start = performance.now();
    htmlToText(html);
    htmlToText(html, true);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('trims trailing punctuation from a long link in linear time', () => {
    const start = performance.now();
    const links = linksInText(`http://${'.'.repeat(200_000)}x`);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(links).toHaveLength(1);
  });
});

describe('cleaning', () => {
  it('normalises whitespace, quotes and invisible characters', () => {
    expect(normalizeText('a b​c ’x’ “y”\r\nz')).toBe('a bc \'x\' "y"\nz');
  });

  it('strips quoted history, signatures and footers', () => {
    const body = [
      'Thanks for applying.',
      'Unsubscribe from these emails',
      '> quoted line',
      'More text.',
      '-- ',
      'Signature',
    ].join('\n');
    expect(stripNoise(body)).toBe('Thanks for applying.\nMore text.');
    expect(stripNoise('New\n\nOn Wed, 1 Oct 2026 at 10:00, Dana <d@x.example>\nwrote:\nOld')).toBe(
      'New',
    );
    expect(stripNoise('New\n-----Original Message-----\nOld')).toBe('New');
    expect(stripNoise('New\nFrom: Dana\nSent: Wednesday\nSubject: Old\nOld')).toBe('New');
  });

  it('unwraps a manual forward', () => {
    const fwd = unwrapForward(
      '---------- Forwarded message ---------\nFrom: A <a@x.example>\nSubject: Hi\nDate: today\n\nBody',
    );
    expect(fwd).toEqual({ header: { from: 'A <a@x.example>', subject: 'Hi' }, body: '\nBody' });
    expect(
      unwrapForward('Begin forwarded message:\n\nFrom: B <b@x.example>\n\nText')?.header.from,
    ).toBe('B <b@x.example>');
    expect(unwrapForward('No forward here')).toBeUndefined();
    expect(
      unwrapForward(`${'x'.repeat(500)}\n---------- Forwarded message ---------\nFrom: A`),
    ).toBeUndefined();
  });

  it('expands contractions and splits sentences', () => {
    expect(
      canonicalWords("We Won't, can't, didn't; we're, we've, we'll, I'm, we'd, it's, let's"),
    ).toBe('we will not, cannot, did not; we are, we have, we will, i am, we would, it is, let us');
    expect(splitSentences('One. Two! three\nFour?  5 apples. ---')).toEqual([
      'One.',
      'Two! three',
      'Four?',
      '5 apples. ---',
    ]);
  });
});

describe('time', () => {
  it('converts wall times in a zone to instants across DST', () => {
    expect(
      zonedToInstant(
        { year: 2026, month: 10, day: 3, hour: 10, minute: 0 },
        'Australia/Sydney',
      ).toISOString(),
    ).toBe('2026-10-03T00:00:00.000Z');
    expect(
      zonedToInstant(
        { year: 2026, month: 10, day: 5, hour: 10, minute: 0 },
        'Australia/Sydney',
      ).toISOString(),
    ).toBe('2026-10-04T23:00:00.000Z');
    // 02:30 on the spring-forward day doesn't exist; it resolves forwards.
    expect(
      zonedToInstant(
        { year: 2026, month: 10, day: 4, hour: 2, minute: 30 },
        'Australia/Sydney',
      ).toISOString(),
    ).toBe('2026-10-03T16:30:00.000Z');
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 1), 'America/New_York')).toBe(-300);
  });

  it('resolves zone names', () => {
    expect(resolveTimeZone('AUS Eastern Standard Time')).toBe('Australia/Sydney');
    expect(resolveTimeZone('aest')).toBe('Australia/Sydney');
    expect(resolveTimeZone('/mozilla.org/20050126_1/Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTimeZone('"America/Chicago"')).toBe('America/Chicago');
    expect(resolveTimeZone('Mars/Olympus')).toBeUndefined();
    expect(resolveTimeZone(undefined)).toBeUndefined();
  });

  const at = '2026-10-01T09:00:00+10:00'; // a Thursday in Sydney

  it.each([
    ['Thursday 9 October at 10am AEST', { start: '2026-10-08T23:00:00.000Z', floating: false }],
    [
      'on 3rd Oct, 10:00-11:30 (AEST)',
      { start: '2026-10-03T00:00:00.000Z', end: '2026-10-03T01:30:00.000Z' },
    ],
    [
      'Friday, October 10, 2026 at 2:30 PM PT',
      { start: '2026-10-10T21:30:00.000Z', timeZone: 'America/Los_Angeles' },
    ],
    ['2026-10-12 09:15', { start: '2026-10-12T09:15:00', floating: true }],
    ['tomorrow at 2pm', { start: '2026-10-02T14:00:00', floating: true }],
    ['today at 4:30pm', { start: '2026-10-01T16:30:00' }],
    ['next Tuesday at 11am', { start: '2026-10-06T11:00:00' }],
    ['on Thursday at 9:30', { start: '2026-10-08T09:30:00' }],
    ['12 January at 12am', { start: '2027-01-12T00:00:00' }],
    ['12 March at 12pm', { start: '2027-03-12T12:00:00' }],
  ])('reads %s', (text, expected) => {
    expect(findDateTime(text, at)).toMatchObject(expected);
  });

  it.each([
    '3 October',
    'the meeting on 31 February at 10am',
    'Thursday 3',
    'at 25:00pm on 3 Oct',
    'Zarch 3 at 10am',
  ])('ignores %s', (text) => {
    expect(findDateTime(text, at)).toBeUndefined();
  });

  it('uses UTC for the reference date when the Date has no offset', () => {
    expect(findDateTime('tomorrow at 9am', '2026-10-01T23:30:00Z')?.start).toBe(
      '2026-10-02T09:00:00',
    );
  });
});

describe('parseCalendar', () => {
  it('reads UTC, floating and all-day events', () => {
    expect(
      parseCalendar(
        'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261003T000000Z\nDTEND:20261003T010000Z\nURL:https://x.example\nEND:VEVENT\nEND:VCALENDAR',
      ),
    ).toMatchObject({
      start: '2026-10-03T00:00:00.000Z',
      end: '2026-10-03T01:00:00.000Z',
      timeZone: 'UTC',
      floating: false,
      url: 'https://x.example',
    });
    expect(
      parseCalendar(
        'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261003T100000\nEND:VEVENT\nEND:VCALENDAR',
      ),
    ).toMatchObject({
      start: '2026-10-03T10:00:00',
      floating: true,
    });
    expect(
      parseCalendar(
        'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261003\nEND:VEVENT\nEND:VCALENDAR',
      ),
    ).toMatchObject({
      start: '2026-10-03',
      allDay: true,
    });
    expect(
      parseCalendar(
        'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=Nowhere/Land:20261003T100000\nDTSTART:bad\nEND:VEVENT\nEND:VCALENDAR',
      ),
    ).toMatchObject({ floating: true });
  });

  it('ignores alarms, unescapes text and handles quoted parameters', () => {
    const invite = parseCalendar(
      'BEGIN:VCALENDAR\nMETHOD:request\nBEGIN:VEVENT\nSUMMARY:A\\, B\\; C\nORGANIZER;CN="Doe: Jane":mailto:j@x.example\nnot a property\nBEGIN:VALARM\nSUMMARY:Alarm\nEND:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Second\nEND:VEVENT\nEND:VCALENDAR',
    );
    expect(invite).toMatchObject({ method: 'REQUEST', summary: 'A, B; C', start: undefined });
  });

  it('returns undefined without an event', () => {
    expect(parseCalendar('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBeUndefined();
  });
});

describe('links', () => {
  it.each([
    ['https://us02web.zoom.us/j/123', 'meeting'],
    ['https://meet.google.com/abc-defg-hij', 'meeting'],
    ['https://teams.microsoft.com/l/meetup-join/19%3a', 'meeting'],
    ['https://acme.webex.com/meet/sam', 'meeting'],
    ['https://calendly.com/acme/30min', 'scheduler'],
    ['https://app.greenhouse.io/scheduling/abc', 'scheduler'],
    ['https://www.hackerrank.com/test/abc', 'assessment'],
    ['https://app.codility.com/c/x', 'assessment'],
    ['https://boards.greenhouse.io/acme/jobs/123', 'posting'],
    ['https://acme.example/careers/data-analyst-1234', 'posting'],
    ['https://acme.example/careers/unsubscribe/1234', 'other'],
    ['https://acme.example/about', 'other'],
    ['mailto:x@y.z', 'other'],
    ['not a url', 'other'],
  ])('classifies %s as %s', (href, kind) => {
    expect(classifyLink(href)).toBe(kind);
  });

  it('keeps the first link of each kind and de-duplicates postings', () => {
    const out = classifyLinks([
      { href: 'https://zoom.us/j/1', text: '' },
      { href: 'https://zoom.us/j/2', text: '' },
      { href: 'https://boards.greenhouse.io/acme/jobs/1?utm_source=x', text: '' },
      { href: 'https://boards.greenhouse.io/acme/jobs/1', text: '' },
      { href: 'https://acme.example/jobs/2', text: 'Unsubscribe' },
    ]);
    expect(out).toEqual({
      meeting: 'https://zoom.us/j/1',
      postings: ['https://boards.greenhouse.io/acme/jobs/1'],
    });
  });
});

describe('recruiting systems', () => {
  it('detects the system from the sender or the posting links', () => {
    expect(detectAts('us.greenhouse-mail.io', [])).toBe('greenhouse');
    expect(detectAts('acme.example', ['https://jobs.lever.co/acme/x'])).toBe('lever');
    expect(detectAts('acme.example', ['not a url'])).toBeUndefined();
    expect(isPlatformDomain('gmail.com')).toBe(true);
    expect(isPlatformDomain('acme.example')).toBe(false);
  });

  // Job ids from email links must equal what capture stores as `externalId`.
  it.each([
    'https://job-boards.greenhouse.io/acme/jobs/4012345',
    'https://boards.greenhouse.io/embed/job_app?for=acme&token=55',
    'https://jobs.lever.co/acme/8a1f2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d/apply',
    'https://jobs.ashbyhq.com/acme/8a1f2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
    'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Sydney/Analyst_R-04512/apply',
    'https://jobs.smartrecruiters.com/Acme/744000012345678-qa-engineer',
    'https://careers-acme.icims.com/jobs/1187/claims/job',
    'https://www.seek.com.au/job/78123456',
    'https://www.linkedin.com/jobs/view/data-analyst-at-acme-4123456789',
  ])('reads the same job id as the site adapter: %s', (href) => {
    const url = new URL(href);
    const fromAdapter = findAdapterByHost(url)?.externalId?.(url);
    expect(fromAdapter).toBeTruthy();
    expect(jobIdFromUrl(href)).toBe(fromAdapter);
  });

  it('has no job id for other links', () => {
    expect(jobIdFromUrl('https://acme.example/jobs/1')).toBeUndefined();
    expect(jobIdFromUrl('nope')).toBeUndefined();
  });

  it('reads company and title hints', () => {
    expect(
      extractHints({
        subject: 'Re: Interview invitation: Data Analyst at Northwind Labs',
        body: '',
        postingUrls: [],
      }),
    ).toEqual({ companyHint: 'Northwind Labs', titleHint: 'Data Analyst', atsJobId: undefined });
    expect(
      extractHints({
        subject: 'Hello',
        body: 'We are pleased to offer you the position of Product Designer.',
        postingUrls: [],
        senderName: 'Quokka Health Careers',
      }),
    ).toMatchObject({ companyHint: 'Quokka Health', titleHint: 'Product Designer' });
    expect(
      extractHints({ subject: 'Your application', body: 'Ref number: ABC-123', postingUrls: [] })
        .atsJobId,
    ).toBe('ABC-123');
  });

  it('takes the company from the sender name, but not from a platform', () => {
    expect(companyFromSenderName('Acme Talent Acquisition', undefined)).toBe('Acme');
    expect(companyFromSenderName('LinkedIn', 'linkedin')).toBeUndefined();
    expect(companyFromSenderName('Greenhouse', undefined)).toBeUndefined();
    expect(companyFromSenderName('Careers', undefined)).toBeUndefined();
    expect(companyFromSenderName(undefined, undefined)).toBeUndefined();
  });
});

describe('scoreIntents', () => {
  it('ignores negated positive phrases', () => {
    expect(scoreIntents('Hi', 'We have not received your application yet.').scores.received).toBe(
      0,
    );
    expect(
      scoreIntents('Hi', 'We did not invite you to an interview, but we will.').scores.interview,
    ).toBe(0);
  });

  it('does not let a "but" carry a negation forward', () => {
    expect(
      scoreIntents('Hi', 'Not long ago we met, but we would like to invite you to an interview.')
        .scores.interview,
    ).toBeGreaterThan(0);
  });

  it('discounts hedged and conditional progress', () => {
    expect(
      scoreIntents('Hi', 'Should you be successful, we will invite you to an interview.').scores
        .interview,
    ).toBe(0);
    expect(scoreIntents('Hi', 'We might invite you to an interview.').scores.interview).toBeCloseTo(
      4 * 1.5 * 0.35,
    );
  });

  it('counts each rule once', () => {
    const once = scoreIntents('Hi', 'Unfortunately.').scores.rejected;
    expect(scoreIntents('Hi', 'Unfortunately. Unfortunately. Unfortunately.').scores.rejected).toBe(
      once,
    );
  });
});

describe('analyzeEmail', () => {
  it('parses senders', () => {
    expect(parseSender('"Acme, Careers" <Jobs@Acme.Example>')).toEqual({
      address: 'jobs@acme.example',
      domain: 'acme.example',
      name: 'Acme, Careers',
    });
    expect(parseSender('jobs@acme.example')).toEqual({
      address: 'jobs@acme.example',
      domain: 'acme.example',
      name: undefined,
    });
    expect(parseSender('<x>')).toMatchObject({ address: 'x', domain: '' });
  });

  it('survives an empty email and a bad date', () => {
    const event = analyzeEmail({ from: '', subject: '', date: 'not a date' });
    expect(event).toMatchObject({
      intent: 'other',
      action: 'none',
      receivedAt: '1970-01-01T00:00:00.000Z',
      postingUrls: [],
    });
  });

  it('prefers the text part and keeps thread ids', () => {
    const event = analyzeEmail({
      from: 'a@b.example',
      subject: 'x',
      date: '2026-10-01T00:00:00Z',
      text: 'plain',
      html: '<p>We regret to inform you</p>',
      messageId: '<m1>',
      inReplyTo: '<m0>',
      references: ['<a>', '<m0>'],
    });
    expect(event.intent).toBe('other');
    expect(event.thread).toEqual({
      messageId: '<m1>',
      inReplyTo: '<m0>',
      references: ['<a>', '<m0>'],
    });
  });

  it('reads the Gmail code from the subject when the body lacks it, and only trusts Google links', () => {
    const event = analyzeEmail({
      from: 'forwarding-noreply@google.com',
      subject: '(#987654321) Gmail Forwarding Confirmation',
      date: '2026-10-01T00:00:00Z',
      text: 'Click https://evil.example/mail/vf-1 or bad link http://mail-settings.google.com/x',
    });
    expect(event.verification).toEqual({ code: '987654321', url: undefined });
  });

  it('does not let a scheduling link override a clear rejection', () => {
    const event = analyzeEmail({
      from: 'jobs@acme.example',
      subject: 'Your application',
      date: '2026-10-01T00:00:00Z',
      text: 'We regret to inform you that we will not be moving forward with your application. https://calendly.com/acme/feedback',
    });
    expect(event.intent).toBe('rejected');
  });

  it('ignores calendar replies and all-day events', () => {
    const reply = analyzeEmail({
      from: 'jobs@acme.example',
      subject: 'Accepted: Interview',
      date: '2026-10-01T00:00:00Z',
      calendar:
        'BEGIN:VCALENDAR\nMETHOD:REPLY\nBEGIN:VEVENT\nDTSTART:20261003T000000Z\nEND:VEVENT\nEND:VCALENDAR',
    });
    expect(reply.interview).toBeUndefined();
  });
});
