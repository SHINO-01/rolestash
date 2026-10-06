import { looksLikeJobView } from '@/extraction/job-view';

const doc = (html = '') =>
  new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');

describe('is a job open? (the widget button, ADR-0030)', () => {
  it('knows a job from the site’s own id in the URL', () => {
    expect(looksLikeJobView(new URL('https://www.linkedin.com/jobs/view/4470914440/'), doc())).toBe(
      true,
    );
    expect(
      looksLikeJobView(
        new URL('https://www.linkedin.com/jobs/search/?currentJobId=4470914440'),
        doc(),
      ),
    ).toBe(true);
    expect(looksLikeJobView(new URL('https://www.seek.com.au/job/81234567'), doc())).toBe(true);
  });

  it('knows a job from structured data on any page', () => {
    const ld =
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"x"}</script>';
    expect(looksLikeJobView(new URL('https://careers.acme.example/roles/1'), doc(ld))).toBe(true);
    const list = '<script type="application/ld+json">{"@type":["JobPosting"]}</script>';
    expect(looksLikeJobView(new URL('https://careers.acme.example/'), doc(list))).toBe(true);
    const micro = '<div itemscope itemtype="https://schema.org/JobPosting"></div>';
    expect(looksLikeJobView(new URL('https://careers.acme.example/'), doc(micro))).toBe(true);
  });

  it('says no on feeds, searches and other structured data', () => {
    expect(looksLikeJobView(new URL('https://www.linkedin.com/feed/'), doc())).toBe(false);
    expect(looksLikeJobView(new URL('https://www.seek.com.au/software-jobs'), doc())).toBe(false);
    const org =
      '<script type="application/ld+json">{"@type":"Organization","name":"JobPosting Inc"}</script>';
    expect(looksLikeJobView(new URL('https://acme.example/'), doc(org))).toBe(false);
  });
});
