import { showsLauncher } from '@/features/capture/widget-protocol';

describe('where the button appears by itself (ADR-0033)', () => {
  it('is on the supported job sites, and everywhere once all sites is on', () => {
    expect(showsLauncher('https://www.seek.com.au/job/1', false)).toBe(true);
    expect(showsLauncher('https://careers.acme.example/jobs/1', false)).toBe(false);
    expect(showsLauncher('https://careers.acme.example/jobs/1', true)).toBe(true);
  });

  it('is never on Rolestash itself or on non-web pages', () => {
    for (const href of [
      'https://rolestash.com/board/',
      'https://www.rolestash.com/',
      'file:///tmp/a.html',
      'nope',
    ])
      expect(showsLauncher(href, true), href).toBe(false);
  });
});
