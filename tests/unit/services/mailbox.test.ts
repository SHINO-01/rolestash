import { analyzeEmail } from '@/email';
import {
  EMAIL_UPDATE_PREFIX,
  EmailUpdateService,
  emailNotification,
} from '@/services/email-update-service';
import { JobService } from '@/services/job-service';
import {
  gmailAuthUrl,
  gmailOffered,
  gmailQuery,
  GMAIL_SCOPE,
  GMAIL_FOR_EVERYONE,
  GMAIL_VERIFIED,
  readGmailRedirect,
} from '@/services/mail/gmail';
import { outlookToken, readOutlookRedirect } from '@/services/mail/outlook';
import { MailAuthError } from '@/services/mail/types';
import { MailboxService } from '@/services/mailbox-service';
import type { EmailInbox, Notifier, WebAuthFlow } from '@/services/ports';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { MAILBOX_AUTH_KEY } from '@/storage/keys';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob, testContext } from '../helpers/factories';
import { fakeFetch } from '../helpers/fake-fetch';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const REDIRECT = 'https://abc.chromiumapp.org/';
const b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Google's redirect for whatever sign-in URL it's given, echoing its state. */
function googleRedirect(url: string, scope = GMAIL_SCOPE): string {
  const state = new URL(url).searchParams.get('state') ?? '';
  return `${REDIRECT}#access_token=ya29.token&expires_in=3600&token_type=Bearer&scope=${encodeURIComponent(scope)}&state=${state}`;
}

class FakeAuthFlow implements WebAuthFlow {
  launched: string[] = [];
  silent: string[] = [];
  silentWorks = true;
  redirectUrl() {
    return REDIRECT;
  }
  launch(url: string) {
    this.launched.push(url);
    return Promise.resolve(googleRedirect(url));
  }
  launchSilently(url: string) {
    this.silent.push(url);
    return Promise.resolve(this.silentWorks ? googleRedirect(url) : undefined);
  }
}

interface FakeMail {
  id: string;
  from: string;
  subject: string;
  at: string;
  html?: string;
}

function gmailApi(mail: FakeMail[], opts: { revoked?: () => boolean } = {}) {
  const header = (m: FakeMail) => [
    { name: 'From', value: m.from },
    { name: 'Subject', value: m.subject },
    { name: 'Date', value: new Date(m.at).toUTCString() },
    { name: 'Message-ID', value: `<${m.id}@mail>` },
  ];
  const auth = (call: { headers: Record<string, string> }) =>
    (opts.revoked?.() ?? false) || call.headers.Authorization !== 'Bearer ya29.token';
  return fakeFetch({
    [`GET ${API}/profile`]: { status: 200, body: { emailAddress: 'sam@gmail.com' } },
    [`GET ${API}/messages`]: (call) => {
      if (auth(call)) return { status: 401, body: {} };
      const after = Number(/after:(\d+)/.exec(decodeURIComponent(call.url))?.[1] ?? 0) * 1000;
      // Newest first, like Gmail.
      const ids = mail
        .filter((m) => Date.parse(m.at) > after)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((m) => ({ id: m.id }));
      return { status: 200, body: { messages: ids } };
    },
    [`GET ${API}/messages/*`]: (call) => {
      const id = /messages\/([^?]+)/.exec(call.url)?.[1] ?? '';
      const m = mail.find((x) => x.id === id);
      if (!m) return { status: 404, body: {} };
      const full = call.url.includes('format=full');
      return {
        status: 200,
        body: {
          id: m.id,
          internalDate: String(Date.parse(m.at)),
          payload: {
            mimeType: 'text/html',
            headers: header(m),
            ...(full ? { body: { data: b64url(m.html ?? '<p>Hello</p>') } } : {}),
          },
        },
      };
    },
    'POST https://oauth2.googleapis.com/revoke*': { status: 200, body: {} },
  });
}

async function setup(mail: FakeMail[], opts: { revoked?: () => boolean } = {}) {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const ctx = testContext('2026-10-06T00:00:00.000Z');
  const auth = new FakeAuthFlow();
  const api = gmailApi(mail, opts);
  const mailbox = new MailboxService(store, auth, api.fetch, { googleClientId: 'gid' }, ctx);
  return { store, ctx, auth, api, mailbox };
}

const nw = {
  id: 'n1',
  from: 'Northwind Labs <no-reply@us.greenhouse-mail.io>',
  subject: 'Your application to Northwind Labs',
  at: '2026-10-05T10:00:00Z',
  html: '<p>Unfortunately, we will not be moving forward with your application.</p><a href="https://job-boards.greenhouse.io/northwindlabs/jobs/4012345">Posting</a>',
};
const dinner = {
  id: 'd1',
  from: 'Mum <mum@gmail.com>',
  subject: 'Dinner Sunday?',
  at: '2026-10-05T11:00:00Z',
};

describe('offering Gmail before Google verifies the scope', () => {
  it('release builds offer it to everyone before verification (0.6.7); closed, only to testers', () => {
    // Flip GMAIL_VERIFIED only once Google approves (docs/guides/gmail-verification.md).
    expect(GMAIL_VERIFIED).toBe(false);
    expect(GMAIL_FOR_EVERYONE).toBe(true);
    expect(gmailOffered('production')).toBe(true);
    expect(gmailOffered('production', false, false)).toBe(false);
    expect(gmailOffered('production', true, false)).toBe(true);
    expect(gmailOffered('staging')).toBe(true);
    expect(gmailOffered('development')).toBe(true);
    expect(gmailOffered('e2e')).toBe(true);
    expect(gmailOffered('production', false, true)).toBe(true);
  });

  it('lists Gmail for everyone in a release build, testers included', () => {
    const service = new MailboxService(
      new MemoryKeyValueStore(),
      new FakeAuthFlow(),
      fetch,
      { googleClientId: 'gid', microsoftClientId: 'mid', mode: 'production' },
      testContext('2026-10-06T00:00:00.000Z'),
    );
    expect(service.providers()).toEqual(['gmail', 'outlook']);
    expect(service.providers(true)).toEqual(['gmail', 'outlook']);
  });
});

describe('Gmail sign-in (ADR-0032)', () => {
  it('asks for read-only Gmail, and renews silently for the same account', () => {
    const first = new URL(gmailAuthUrl({ clientId: 'gid', redirectUri: REDIRECT, state: 's' }));
    expect(first.searchParams.get('scope')).toBe(GMAIL_SCOPE);
    expect(first.searchParams.get('response_type')).toBe('token');
    expect(first.searchParams.get('prompt')).toBe('consent select_account');
    const renew = new URL(
      gmailAuthUrl({
        clientId: 'gid',
        redirectUri: REDIRECT,
        state: 's',
        silent: true,
        loginHint: 'sam@gmail.com',
      }),
    );
    expect(renew.searchParams.get('prompt')).toBe('none');
    expect(renew.searchParams.get('login_hint')).toBe('sam@gmail.com');
  });

  it('accepts only its own redirect, with Gmail access actually granted', () => {
    const url = gmailAuthUrl({ clientId: 'gid', redirectUri: REDIRECT, state: 'good' });
    expect(readGmailRedirect(googleRedirect(url), 'good', 0)).toEqual({
      accessToken: 'ya29.token',
      expiresAt: 3_600_000,
    });
    expect(() => readGmailRedirect(googleRedirect(url), 'other', 0)).toThrow(MailAuthError);
    expect(() => readGmailRedirect(googleRedirect(url, 'openid email'), 'good', 0)).toThrow(
      /not allowed/,
    );
  });

  it('lets Gmail’s search do the first cut, quoting employers safely', () => {
    const q = gmailQuery(new Date('2026-10-01T00:00:00Z'), ['Northwind Labs', 'X', 'Acme "Co"']);
    expect(q).toContain('after:1790812800');
    expect(q).toContain('-category:promotions');
    expect(q).toContain('greenhouse.io');
    expect(q).toContain('"Northwind Labs"');
    expect(q).not.toContain('"X"');
    expect(q).toContain('"Acme  Co"');
  });
});

describe('a busy inbox (owner demo, 9 October 2026)', () => {
  it('reads new mail at once, however much older job-board mail there is', async () => {
    // Two weeks of LinkedIn alerts and application receipts, then the interview.
    const mail: FakeMail[] = Array.from({ length: 120 }, (_, i) => ({
      id: `li${String(i)}`,
      from: 'LinkedIn <jobs-noreply@linkedin.com>',
      subject: `Sam, your application was sent to Company ${String(i)}`,
      at: new Date(Date.parse('2026-09-23T00:00:00Z') + i * 2 * 3600_000).toISOString(),
    }));
    mail.push({
      id: 'nw',
      from: 'Jordan Lee <jordan.lee.careers@gmail.com>',
      subject: 'Interview invitation: Frontend Engineer at Northwind Labs',
      at: '2026-10-05T23:59:00Z',
      html: '<div>Thank you for applying for the Frontend Engineer role at Northwind Labs. We would like to invite you to a video interview.</div><div>When: Thursday, 15 October 2026 at 10:00am AEDT</div><div>Join: <a href="https://meet.google.com/abc-defg-hij">https://meet.google.com/abc-defg-hij</a></div><div>Kind regards,<br>Jordan Lee<br>Talent Team, Northwind Labs</div>',
    });
    const { store, ctx, mailbox, api } = await setup(mail);
    const jobs = new JobRepository(store);
    const settings = new SettingsRepository(store);
    const jobService = new JobService(jobs, settings, ctx);
    await jobs.save(
      makeJob({
        id: 'fe',
        stageId: 'applied',
        appliedAt: '2026-10-05T23:00:00.000Z',
        title: 'Front End Engineer',
        company: 'Northwind Labs',
      }),
    );
    const inbox: EmailInbox = {
      address: () =>
        Promise.resolve({ ok: true, address: 'x@in.rolestash.com', shareLearning: true }),
      events: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      vote: () => Promise.resolve(),
      setSharing: () => Promise.resolve(),
    };
    const service = new EmailUpdateService(
      store,
      jobs,
      settings,
      jobService,
      inbox,
      { currentPlan: () => Promise.resolve('pro'), onTrial: () => Promise.resolve(false) },
      ctx,
      mailbox,
    );
    await mailbox.connect('gmail');
    await service.run();
    expect((await jobs.get('fe'))?.stageId).toBe('interviewing');
    // One page of the newest, not the whole two weeks.
    const fulls = api.calls.filter((c) => c.url.includes('format=full')).length;
    expect(fulls).toBeLessThanOrEqual(30);
  });
});

describe('notifications for email updates', () => {
  class FakeNotifier implements Notifier {
    shown: { id: string; title: string; message: string }[] = [];
    constructor(private readonly allowed = true) {}
    granted() {
      return Promise.resolve(this.allowed);
    }
    notify(id: string, title: string, message: string) {
      this.shown.push({ id, title, message });
      return Promise.resolve();
    }
  }

  async function service(notifier: Notifier) {
    const mail: FakeMail[] = [
      {
        id: 'nw',
        from: 'Jordan Lee <jordan@northwindlabs.example>',
        subject: 'Interview invitation: Frontend Engineer at Northwind Labs',
        at: '2026-10-05T23:59:00Z',
        html: '<div>Thank you for applying for the Frontend Engineer role at Northwind Labs. We would like to invite you to a video interview.</div><div>When: Thursday, 15 October 2026 at 10:00am AEDT</div><div>Join: https://meet.google.com/abc-defg-hij</div><div>Jordan Lee<br>Talent Team, Northwind Labs</div>',
      },
    ];
    const { store, ctx, mailbox } = await setup(mail);
    const jobs = new JobRepository(store);
    const settings = new SettingsRepository(store);
    await jobs.save(
      makeJob({
        id: 'fe',
        stageId: 'applied',
        appliedAt: '2026-10-05T23:00:00.000Z',
        title: 'Frontend Engineer',
        company: 'Northwind Labs',
      }),
    );
    const inbox: EmailInbox = {
      address: () =>
        Promise.resolve({ ok: true, address: 'x@in.rolestash.com', shareLearning: true }),
      events: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      vote: () => Promise.resolve(),
      setSharing: () => Promise.resolve(),
    };
    const email = new EmailUpdateService(
      store,
      jobs,
      settings,
      new JobService(jobs, settings, ctx),
      inbox,
      { currentPlan: () => Promise.resolve('pro'), onTrial: () => Promise.resolve(false) },
      ctx,
      mailbox,
      notifier,
    );
    await mailbox.connect('gmail');
    return email;
  }

  it('tells someone on another tab, and a click opens the card', async () => {
    const notifier = new FakeNotifier();
    await (await service(notifier)).run();
    expect(notifier.shown).toHaveLength(1);
    expect(notifier.shown[0]?.id).toBe(`${EMAIL_UPDATE_PREFIX}fe`);
    expect(notifier.shown[0]?.title).toBe('Northwind Labs: interview');
    expect(notifier.shown[0]?.message).toMatch(/^Frontend Engineer · .+ · now in Interviewing$/);
  });

  it('stays quiet for a board in view, and without permission', async () => {
    const inView = new FakeNotifier();
    await (await service(inView)).run({ notify: false });
    expect(inView.shown).toEqual([]);
    const denied = new FakeNotifier(false);
    await (await service(denied)).run();
    expect(denied.shown).toEqual([]);
  });

  it('words a suggestion as one to review', () => {
    const job = makeJob({ title: 'Data Analyst', company: 'Kestrel Health' });
    expect(emailNotification({ job, intent: 'rejected', suggested: true })).toEqual({
      title: 'Kestrel Health: not going ahead',
      message: 'Data Analyst · An email may be about this job: review it on your board',
    });
  });
});

describe('Outlook sign-in', () => {
  it('exchanges a code with PKCE, and treats a dead refresh token as "connect again"', async () => {
    expect(() => readOutlookRedirect(`${REDIRECT}?code=c&state=x`, 'y')).toThrow(MailAuthError);
    expect(readOutlookRedirect(`${REDIRECT}?code=c&state=x`, 'x')).toBe('c');
    const ok = fakeFetch({
      'POST https://login.microsoftonline.com/common/oauth2/v2.0/token': {
        status: 200,
        body: { access_token: 'at', refresh_token: 'rt', expires_in: 60 },
      },
    });
    await expect(
      outlookToken(ok.fetch, {
        clientId: 'mid',
        redirectUri: REDIRECT,
        now: 0,
        code: 'c',
        verifier: 'v',
      }),
    ).resolves.toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 60_000 });
    const dead = fakeFetch({
      'POST https://login.microsoftonline.com/common/oauth2/v2.0/token': {
        status: 400,
        body: { error: 'invalid_grant' },
      },
    });
    await expect(
      outlookToken(dead.fetch, {
        clientId: 'mid',
        redirectUri: REDIRECT,
        now: 0,
        refreshToken: 'old',
      }),
    ).rejects.toBeInstanceOf(MailAuthError);
  });
});

describe('MailboxService', () => {
  it('connects, reads two weeks back, and downloads only job mail', async () => {
    const { mailbox, api } = await setup([nw, dinner]);
    expect(mailbox.providers()).toEqual(['gmail']);
    const state = await mailbox.connect('gmail');
    expect(state).toMatchObject({
      provider: 'gmail',
      address: 'sam@gmail.com',
      since: '2026-09-22T00:00:00.000Z',
    });
    const items = await mailbox.pull([]);
    expect(items.map((i) => i.id)).toEqual(['gmail:n1']);
    expect(analyzeEmail(items[0]!.input).intent).toBe('rejected');
    // Dinner was only glanced at (sender and subject), never downloaded.
    expect(
      api.calls.some((c) => c.url.includes('/messages/d1') && c.url.includes('format=full')),
    ).toBe(false);
  });

  it('never reads a message twice, and moves on past what it handled', async () => {
    const { mailbox } = await setup([nw, dinner]);
    await mailbox.connect('gmail');
    const first = await mailbox.pull([]);
    await mailbox.commit(first.map((i) => i.id));
    expect(await mailbox.pull([])).toEqual([]);
    expect((await mailbox.state())?.since).toBe('2026-10-05T11:00:00.000Z');
  });

  it('renews an expired token silently, and asks to reconnect when it can’t', async () => {
    const { mailbox, auth, store, ctx } = await setup([nw]);
    await mailbox.connect('gmail');
    ctx.advance(2 * 3_600_000);
    await mailbox.pull([]);
    expect(auth.silent).toHaveLength(1);
    expect(new URL(auth.silent[0]!).searchParams.get('login_hint')).toBe('sam@gmail.com');

    await store.set({ [MAILBOX_AUTH_KEY]: { accessToken: 'old', expiresAt: 0 } });
    auth.silentWorks = false;
    expect(await mailbox.pull([])).toEqual([]);
    expect((await mailbox.state())?.problem).toBe('reconnect');
  });

  it('notes a revoked mailbox instead of failing the whole check', async () => {
    let revoked = false;
    const { mailbox } = await setup([nw], { revoked: () => revoked });
    await mailbox.connect('gmail');
    revoked = true;
    expect(await mailbox.pull([])).toEqual([]);
    expect((await mailbox.state())?.problem).toBe('reconnect');
    revoked = false;
    expect(await mailbox.pull([])).toHaveLength(1);
    expect((await mailbox.state())?.problem).toBeUndefined();
  });

  it('forgets the mailbox and revokes Google’s token on disconnect', async () => {
    const { mailbox, api, store } = await setup([nw]);
    await mailbox.connect('gmail');
    await mailbox.disconnect();
    expect(await mailbox.state()).toBeUndefined();
    expect(Object.keys(await store.get([MAILBOX_AUTH_KEY]))).toHaveLength(0);
    expect(api.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(
      true,
    );
  });
});

describe('email updates from a connected mailbox', () => {
  it('moves the job when Gmail has the rejection, without any forwarding', async () => {
    const { store, ctx, mailbox } = await setup([nw, dinner]);
    const jobs = new JobRepository(store);
    const settings = new SettingsRepository(store);
    const jobService = new JobService(jobs, settings, ctx);
    await jobs.save(
      makeJob({
        id: 'nw',
        stageId: 'applied',
        appliedAt: '2026-09-20T00:00:00.000Z',
        title: 'Data Analyst',
        company: 'Northwind Labs',
        externalId: '4012345',
        source: {
          url: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345',
          originalUrl: 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345',
          siteId: 'greenhouse',
          siteName: 'Greenhouse',
          capturedAt: '2026-09-20T00:00:00.000Z',
        },
      }),
    );
    const emptyInbox: EmailInbox = {
      address: () =>
        Promise.resolve({ ok: true, address: 'x@in.rolestash.com', shareLearning: true }),
      events: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      vote: () => Promise.resolve(),
      setSharing: () => Promise.resolve(),
    };
    const service = new EmailUpdateService(
      store,
      jobs,
      settings,
      jobService,
      emptyInbox,
      { currentPlan: () => Promise.resolve('pro'), onTrial: () => Promise.resolve(false) },
      ctx,
      mailbox,
    );
    await mailbox.connect('gmail');
    expect(await service.run()).toMatchObject({ applied: 1 });
    expect((await jobs.get('nw'))?.stageId).toBe('rejected');
    // Handled once: the next check does nothing.
    expect(await service.run()).toMatchObject({ applied: 0, suggested: 0, unsorted: 0 });
  });
});
