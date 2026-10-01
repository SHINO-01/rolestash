import { emailSkeleton } from '@/email';
import { MIN_SKELETON_WORDS, skeletonOf } from '@/email/skeleton';

const rejection = (name: string, company: string, title: string, date: string) => ({
  from: `${company} <no-reply@us.greenhouse-mail.io>`,
  subject: `Your application to ${company}`,
  date,
  text: `Hi ${name},\n\nThank you for your interest in the ${title} role at ${company}. Unfortunately, we will not be moving forward with your application at this time.\n\nApply again via https://boards.greenhouse.io/${company.toLowerCase()}/jobs/${String(date.length)} or write to jobs@${company.toLowerCase()}.example. Ref 2026-1187.\n\nBest,\n${company} Recruiting`,
});

describe('template skeletons (ADR-0014 §6)', () => {
  it('is the same for one template sent to different people about different jobs', () => {
    const a = emailSkeleton(rejection('Sam', 'Northwind', 'Data Analyst', '2026-10-01T00:00:00Z'));
    const b = emailSkeleton(
      rejection('Priya', 'Bluegum', 'Senior Platform Engineer', '2026-11-12T00:00:00Z'),
    );
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  it('keeps no names, companies, titles, numbers, links or addresses', () => {
    const s = emailSkeleton(rejection('Sam', 'Northwind', 'Data Analyst', '2026-10-01T00:00:00Z'))!;
    expect(s).not.toMatch(/sam|northwind|analyst|greenhouse|2026|1187|@/i);
    expect(s).toContain('unfortunately we will not be moving forward with your application');
    expect(s).toContain('<w>');
    expect(s).toContain('<url>');
    expect(s).toContain('<email>');
    expect(s).toContain('<n>');
  });

  it('differs between templates', () => {
    const receipt = skeletonOf(
      'Thanks for applying',
      'We have received your application and our team will review it over the coming week.',
    );
    const reject = skeletonOf(
      'Thanks for applying',
      'We will not be moving forward with your application at this time, sadly for everyone.',
    );
    expect(receipt).toBeDefined();
    expect(receipt).not.toBe(reject);
  });

  it('ignores the reply prefix and collapses repeated placeholders', () => {
    expect(
      skeletonOf(
        'Re: Fwd: thanks for applying',
        'we have received your application and will review it soon',
      ),
    ).toBe(
      skeletonOf(
        'thanks for applying',
        'we have received your application and will review it soon',
      ),
    );
    expect(
      skeletonOf(
        'x',
        'call 0400 000 000 or 02 9999 9999 about the role we have for you here today',
      ),
    ).toContain('call <n> or <n> about');
  });

  it(`needs ${String(MIN_SKELETON_WORDS)} template words`, () => {
    expect(skeletonOf('Hi', 'Thanks Sam!')).toBeUndefined();
  });

  it('skips Gmail’s forwarding confirmation', () => {
    expect(
      emailSkeleton({
        from: 'forwarding-noreply@google.com',
        subject: 'Gmail Forwarding Confirmation',
        date: '2026-10-01T00:00:00Z',
        text: 'someone has requested to automatically forward mail to your email address, please click the link below',
      }),
    ).toBeUndefined();
  });
});
