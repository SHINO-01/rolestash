import PostalMime from 'postal-mime';
import {
  handleEmail,
  MAX_RAW_BYTES,
  tokenFrom,
  type Env,
} from '../../../infra/email-worker/src/handle';
import worker from '../../../infra/email-worker/src/index';

const TOKEN = 'k3x9q2w7m4p8r5t6abcd';
const env: Env = {
  SUPABASE_URL: 'https://project.supabase.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  EMAIL_INGEST_SECRET: 'ingest-secret',
};

const crlf = (lines: string[]): string => lines.join('\r\n');

const REJECTION = crlf([
  'From: "Northwind Labs Recruiting" <no-reply@us.greenhouse-mail.io>',
  `To: ${TOKEN}@in.rolestash.com`,
  'Subject: Your application to Northwind Labs',
  'Date: Wed, 01 Oct 2026 09:40:00 +1000',
  'Message-ID: <rej-1@greenhouse-mail.io>',
  'In-Reply-To: <app-1@greenhouse-mail.io>',
  'References: <app-0@greenhouse-mail.io> <app-1@greenhouse-mail.io>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Sam,',
  '',
  'Unfortunately, we will not be moving forward with your application at this t=',
  'ime.',
  '',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Unfortunately, we will not be moving forward with your application.</p>',
  '<a href="https://job-boards.greenhouse.io/northwindlabs/jobs/4012345">Data Analyst</a>',
  '--b1--',
  '',
]);

const INVITE = crlf([
  'From: Alex Chen <alex.chen@northwindlabs.example>',
  `To: ${TOKEN}@in.rolestash.com`,
  'Subject: Data Analyst interview',
  'Date: not a date',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="m1"',
  '',
  '--m1',
  'Content-Type: text/plain',
  '',
  'Please find the invite attached.',
  '--m1',
  'Content-Type: application/ics; name="invite.ics"',
  'Content-Disposition: attachment; filename="invite.ics"',
  'Content-Transfer-Encoding: base64',
  '',
  btoa(
    'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nDTSTART;TZID=Australia/Sydney:20261007T143000\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
  ),
  '--m1--',
  '',
]);

function message(raw: string, to = `${TOKEN}@in.rolestash.com`) {
  return { to, rawSize: raw.length, raw };
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? new Response('{"ok":true,"stored":true}');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('tokenFrom', () => {
  it.each([
    [`${TOKEN}@in.rolestash.com`, TOKEN],
    [`${TOKEN.toUpperCase()}@IN.ROLESTASH.COM`, TOKEN],
    [`${TOKEN}+gmail@in.rolestash.com`, TOKEN],
    [`${TOKEN}@rolestash.com`, undefined],
    ['short@in.rolestash.com', undefined],
    ['l0l0l0l0l0l0l0l0l0l0@in.rolestash.com', undefined],
    ['no-at-sign', undefined],
  ])('%s → %s', (to, token) => {
    expect(tokenFrom(to)).toBe(token);
  });
});

describe('handleEmail', () => {
  it('parses MIME, runs the rules and stores only the event', async () => {
    const { fn, calls } = fakeFetch(json({ ok: true, stored: true }));
    expect(await handleEmail(message(REJECTION), env, fn)).toBe('stored');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://project.supabase.example/rest/v1/rpc/ingest_email_event');
    expect(call.init.headers).toEqual({
      apikey: 'sb_publishable_test',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(call.init.body as string) as {
      p_secret: string;
      p_token: string;
      p_event: Record<string, unknown>;
    };
    expect(body.p_secret).toBe('ingest-secret');
    expect(body.p_token).toBe(TOKEN);
    expect(body.p_event).toMatchObject({
      intent: 'rejected',
      action: 'apply',
      ats: 'greenhouse',
      atsJobId: '4012345',
      receivedAt: '2026-09-30T23:40:00.000Z',
      thread: {
        messageId: '<rej-1@greenhouse-mail.io>',
        inReplyTo: '<app-1@greenhouse-mail.io>',
        references: ['<app-0@greenhouse-mail.io>', '<app-1@greenhouse-mail.io>'],
      },
    });
    // The email body never leaves the Worker; its template only as a SHA-256.
    expect(call.init.body).not.toContain('Hi Sam');
    expect(body.p_event.template).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads an .ics attachment and falls back to now for a bad Date', async () => {
    const { fn, calls } = fakeFetch();
    await handleEmail(message(INVITE), env, fn, new Date('2026-10-01T00:00:00Z'));
    const event = (
      JSON.parse(calls[0]!.init.body as string) as { p_event: Record<string, unknown> }
    ).p_event;
    expect(event).toMatchObject({
      intent: 'interview',
      receivedAt: '2026-10-01T00:00:00.000Z',
      interview: {
        start: '2026-10-07T03:30:00.000Z',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        source: 'calendar',
      },
    });
  });

  it('drops mail to invalid addresses and oversized mail unread', async () => {
    const { fn, calls } = fakeFetch();
    expect(await handleEmail(message(REJECTION, 'sam@in.rolestash.com'), env, fn)).toBe(
      'invalid_address',
    );
    expect(await handleEmail({ ...message(REJECTION), rawSize: MAX_RAW_BYTES + 1 }, env, fn)).toBe(
      'too_large',
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ ok: true, stored: false }, 'duplicate'],
    [{ ok: false, reason: 'unknown_address' }, 'unknown_address'],
    [{ ok: false, reason: 'not_advanced' }, 'not_advanced'],
    [{ ok: false, reason: 'rate_limited' }, 'rate_limited'],
    [{ ok: false, reason: 'something new' }, 'store_failed'],
  ])('reports the database answer %j as %s', async (answer, outcome) => {
    const { fn } = fakeFetch(json(answer));
    expect(await handleEmail(message(REJECTION), env, fn)).toBe(outcome);
  });

  it('retries once on a network error or 5xx, then gives up', async () => {
    const retry = fakeFetch(new Error('offline'), json({ ok: true, stored: true }));
    expect(await handleEmail(message(REJECTION), env, retry.fn)).toBe('stored');
    expect(retry.calls).toHaveLength(2);

    const down = fakeFetch(json({}, 503), json({}, 502));
    expect(await handleEmail(message(REJECTION), env, down.fn)).toBe('store_failed');
    expect(down.calls).toHaveLength(2);

    const refused = fakeFetch(json({ message: 'not allowed' }, 403));
    expect(await handleEmail(message(REJECTION), env, refused.fn)).toBe('store_failed');
    expect(refused.calls).toHaveLength(1);
  });

  it('copes with a message with no headers or body', async () => {
    const { fn, calls } = fakeFetch();
    expect(await handleEmail(message(''), env, fn, new Date('2026-10-01T00:00:00Z'))).toBe(
      'stored',
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      p_event: { intent: 'other', action: 'none' },
    });
  });

  it('reports a message the parser rejects', async () => {
    const parse = vi.spyOn(PostalMime, 'parse').mockRejectedValueOnce(new Error('too deep'));
    const { fn, calls } = fakeFetch();
    expect(await handleEmail(message(REJECTION), env, fn)).toBe('unparseable');
    expect(calls).toHaveLength(0);
    parse.mockRestore();
  });
});

describe('worker entry', () => {
  it('handles email and logs only the outcome', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await worker.email(message(REJECTION, 'nobody@in.rolestash.com'), env);
    expect(log).toHaveBeenCalledWith('email: invalid_address');
    log.mockRestore();
  });
});
