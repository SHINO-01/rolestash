# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People in the middle of a job search who have applied to dozens or hundreds
of roles and lost track: which postings they saved, where they applied, who
replied, what closes when. They are tired, anxious and short on time, and
they have been burned by tools that read their inbox or resell their data.
They find Rolestash on rolestash.com or the Chrome Web Store, usually on a
laptop, sometimes on a phone.

## Product Purpose

Rolestash is a Chrome extension that turns job postings into cards on a
private Kanban board in one click, fills application forms from the user's
own details, and keeps the board up to date. Success for a visitor to the
site: they understand it in one screen, trust it with their search, and add
it to Chrome.

## Positioning

The private job application tracker: no AI reads your applications, no
inbox access, no data selling. Capture and email updates run on plain rules.
The free plan needs no account and keeps everything in the browser; accounts
and sync are optional and paid.

## Operating Context

- Capture: open a posting on a job board or careers page, click the icon or
  press Alt+J; title, company, location, salary, closing date and the
  description are filled in, uncertain fields flagged. Duplicates across sites
  merge into one card.
- Board: Saved → Applied → Screening → Interviewing → Offer, with notes, tags,
  priorities, closing-date warnings and a timeline; side panel beside any page.
- Autofill on application forms (basic free; full on Pro), never demographic
  questions, never submits.
- Advanced: forward job emails to a private address and the board moves the
  card, with interview times on the card.
- Export to CSV or JSON on every plan.

## Capabilities and Constraints

- Plans: Free (30 active jobs), Pro US$7/mo (60, sync up to 3 computers),
  Advanced US$15/mo (unlimited, email updates, phone via the web board,
  14-day free trial, no card). Full comparison lives on `/pricing/`.
- Prices in the buyer's currency through Paddle, merchant of record.
- The site is static HTML with a strict CSP: no scripts (except `/pay/` and
  `/pricing/`), no inline styles, nothing from other origins; fonts and images
  are self-hosted. Header and footer are shared byte for byte across pages.
- Store item: `https://chromewebstore.google.com/detail/rolestash/cncilbdakhabnocnjokbonggomndedgp`.

## Brand Commitments

- Name Rolestash; logo and mark in `brand/` and `site/assets/logo*.svg`.
- Colours stay: spruce `#0b5d52` (accent), amber `#f4b63f`, cream `#fff7e6`,
  mint `#cfe6df`, ink `#10231f`, and the dark-mode equivalents in
  `site/assets/site.css`. Typography may change.
- Voice: plain, specific, calm; no hype, no AI-cliché words, sentence case.
- Never name or show real employers in imagery; fictional companies only.

## Evidence on Hand

- Real product screenshots of the board, light and dark
  (`site/assets/board-*.webp`).
- Verifiable facts: 50+ supported job sites (`docs/reference/supported-sites.md`);
  autofill verified by the owner on real Workday and SmartRecruiters
  applications; Google-verified sign-in; payments by Paddle; data stored in
  Sydney when synced; export any time.
- No customer testimonials yet. Do not invent any. The proof section must be
  designed so real beta-tester quotes can join it after the beta.

## Product Principles

1. Earn trust with specifics, not claims.
2. Calm over urgency: the visitor is already overwhelmed.
3. Privacy is the product, not a feature.
4. One clear next step: Add to Chrome.
