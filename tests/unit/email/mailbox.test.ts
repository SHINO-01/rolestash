import { analyzeEmail } from '@/email';
import {
  decodeBase64Url,
  gmailFirstLook,
  gmailToInput,
  graphToInput,
  likelyJobEmail,
  type GmailMessage,
} from '@/email/mailbox';

const b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('connected mailbox: the first look (ADR-0032)', () => {
  it('picks recruiting systems, application subjects and employers on the board', () => {
    expect(likelyJobEmail({ from: 'Northwind <no-reply@greenhouse.io>', subject: 'Hello' })).toBe(
      true,
    );
    expect(likelyJobEmail({ from: 'a@acme.example', subject: 'Your application to Acme' })).toBe(
      true,
    );
    expect(
      likelyJobEmail({ from: 'Priya <priya@acme.example>', subject: 'Interview on Thursday' }),
    ).toBe(true);
    expect(
      likelyJobEmail({ from: 'Kestrel Energy <hr@kestrel.example>', subject: 'Quick chat?' }, [
        'Kestrel Energy',
      ]),
    ).toBe(true);
  });

  it('leaves everyday mail alone', () => {
    expect(likelyJobEmail({ from: 'Mum <mum@gmail.com>', subject: 'Dinner Sunday?' })).toBe(false);
    expect(
      likelyJobEmail({ from: 'deals@promo.shop.example', subject: '50% off this weekend' }),
    ).toBe(false);
    expect(
      likelyJobEmail({ from: 'Bank <alerts@bank.example>', subject: 'Your statement is ready' }),
    ).toBe(false);
  });
});

describe('Gmail messages', () => {
  const message: GmailMessage = {
    id: 'm1',
    internalDate: '1759800000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Ironwood Grid Careers <no-reply@greenhouse.io>' },
        { name: 'Subject', value: 'Interview: Platform Engineer at Ironwood Grid' },
        { name: 'Date', value: 'Tue, 07 Oct 2026 09:30:00 +1000' },
        { name: 'Message-ID', value: '<abc@greenhouse.io>' },
        { name: 'References', value: '<one@x> <two@x>' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
              body: {
                data: b64url("Hi Sam, we'd like to invite you to an interview — café chat."),
              },
            },
            { mimeType: 'text/html', body: { data: b64url('<p>Hi Sam</p>') } },
          ],
        },
        {
          mimeType: 'text/calendar',
          filename: 'invite.ics',
          body: { data: b64url('BEGIN:VCALENDAR\nEND:VCALENDAR') },
        },
      ],
    },
  };

  it('becomes the engine’s input, every part decoded', () => {
    expect(gmailToInput(message)).toEqual({
      from: 'Ironwood Grid Careers <no-reply@greenhouse.io>',
      subject: 'Interview: Platform Engineer at Ironwood Grid',
      date: '2026-10-06T23:30:00.000Z',
      messageId: '<abc@greenhouse.io>',
      references: ['<one@x>', '<two@x>'],
      text: "Hi Sam, we'd like to invite you to an interview — café chat.",
      html: '<p>Hi Sam</p>',
      calendar: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
    });
    expect(gmailFirstLook(message)).toEqual({
      from: 'Ironwood Grid Careers <no-reply@greenhouse.io>',
      subject: 'Interview: Platform Engineer at Ironwood Grid',
    });
  });

  it('reads the email the same way the forwarding address does', () => {
    const input = gmailToInput(message);
    expect(input && analyzeEmail(input).intent).toBe('interview');
  });

  it('decodes other charsets, and survives a broken one', () => {
    const latin1 = btoa('caf\xe9').replace(/=+$/, '');
    expect(decodeBase64Url(latin1, 'iso-8859-1')).toBe('café');
    expect(decodeBase64Url(b64url('hi'), 'x-made-up')).toBe('hi');
  });

  it('needs a sender, and falls back to Gmail’s own date', () => {
    expect(gmailToInput({ id: 'x', payload: { headers: [] } })).toBeUndefined();
    const noDate = gmailToInput({
      id: 'y',
      internalDate: '1759800000000',
      payload: { headers: [{ name: 'From', value: 'a@b.example' }], mimeType: 'text/plain' },
    });
    expect(noDate?.date).toBe(new Date(1759800000000).toISOString());
  });
});

describe('Outlook messages', () => {
  it('becomes the engine’s input', () => {
    expect(
      graphToInput({
        id: 'o1',
        subject: 'Update on your application',
        receivedDateTime: '2026-10-07T01:00:00Z',
        internetMessageId: '<o1@outlook>',
        from: { emailAddress: { name: 'Acme Talent', address: 'talent@acme.example' } },
        body: { contentType: 'html', content: '<p>Unfortunately…</p>' },
      }),
    ).toEqual({
      from: 'Acme Talent <talent@acme.example>',
      subject: 'Update on your application',
      date: '2026-10-07T01:00:00.000Z',
      messageId: '<o1@outlook>',
      html: '<p>Unfortunately…</p>',
    });
    expect(graphToInput({ id: 'o2', from: null })).toBeUndefined();
  });
});
