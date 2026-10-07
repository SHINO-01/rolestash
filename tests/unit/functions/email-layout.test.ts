// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeEmail, grantEmail, referralEmail } from '../../../infra/ops-worker/src/emails';
import { signInCodeEmail, welcomeEmail } from '../../../supabase/functions/_shared/account-emails';
import {
  EMAIL_HEADER,
  EMAIL_MARK_URL,
  renderEmail,
} from '../../../supabase/functions/_shared/email-layout';
import {
  confirmationEmail,
  launchEmail,
  newsEmail,
} from '../../../supabase/functions/_shared/launch-emails';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('one look for every email', () => {
  const all = {
    'sign-in code': signInCodeEmail(),
    welcome: welcomeEmail('Dana Smith'),
    confirmation: confirmationEmail('https://x/confirm', 'https://x/remove'),
    launch: launchEmail('pro', 'https://store', 'https://x/unsub'),
    news: newsEmail({ subject: 'News', paragraphs: ['Hello.'] }, 'https://x/unsub'),
    grant: grantEmail({ until: '', hasAccount: true }),
    code: codeEmail(
      {
        code: 'LAUNCH30',
        percent: 30,
        payments: 'the first payment',
        plans: '',
        until: '',
        note: '',
        personal: false,
      },
      'https://x/optout',
    ),
    referrals: referralEmail({ percent: 50, note: '' }, 'https://x/optout'),
  };

  it.each(Object.entries(all))('%s uses the shared header and logo', (_name, email) => {
    expect(email.html).toContain(EMAIL_HEADER);
    expect(email.text).toContain('support@rolestash.com');
  });

  it('serves the logo the emails link to', () => {
    expect(EMAIL_MARK_URL).toBe('https://rolestash.com/assets/email-mark.png');
    expect(existsSync(resolve(ROOT, 'site/assets/email-mark.png'))).toBe(true);
  });

  it('keeps the Supabase sign-in code template in step (npm run email:templates)', () => {
    const file = readFileSync(resolve(ROOT, 'supabase/templates/sign-in-code.html'), 'utf8');
    expect(file).toBe(`${signInCodeEmail().html}\n`);
    expect(file).toContain('{{ .Token }}');
  });

  it('escapes text, and has a plain-text version', () => {
    const email = renderEmail({
      subject: 's',
      preheader: 'p',
      title: '<b>Hi</b>',
      paragraphs: ['a & b'],
      why: 'w',
    });
    expect(email.html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(email.html).toContain('a &amp; b');
    expect(email.text).toContain('<b>Hi</b>');
  });
});
