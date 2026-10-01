# ADR-0020: Application autofill: a local profile, deterministic field rules, filled only on a click

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Advanced promises application autofill: type your details once, and fill
Greenhouse, Lever, Workday, Ashby and SmartRecruiters forms, plus company
careers pages. Constraints:

- **No AI or third parties** (AGENTS.md). Matching must be deterministic.
- **Least privilege:** no new permissions, and no persistent content scripts
  (ADR-0004).
- **The profile is personal data** (phone, address, work rights), so it must
  stay as private as the board, or more.
- **A wrong answer on a job application is costly.** Some questions must
  never be answered automatically: equal-opportunity and demographic
  questions, and identity or bank details.

## Decision

- **The profile lives on this device only** (`profile` key,
  `src/domain/profile.ts`). It holds:
  - name, contact, address, links and current role;
  - two yes/no work-rights answers;
  - salary expectation, notice period and "how you heard";
  - up to 30 saved answers for recurring questions.

  It isn't synced and isn't in backups. It is edited in **Autofill
  profile…** on the board.

- **Filling happens only on a click,** from the popup's **Fill this
  application** or the right-click **Fill this application with Rolestash**.
  - Like capture, it uses the `activeTab` grant and `scripting`. The
    bundled `autofill.js` is injected, then called with the profile, so the
    profile reaches that one page and only then.
  - Frames the grant doesn't cover are skipped. In practice that means a
    form embedded from another site, and the popup says to open it on its
    own page.
- **Reading a form** (`src/autofill/fields.ts`, pure, DOM only) works out
  what each question is from, in order:
  1. exact per-system rules (Greenhouse ids, Lever `name`s, Ashby
     `_systemfield_*`, Workday `data-automation-id`, SmartRecruiters ids);
  2. the `autocomplete` attribute;
  3. label wording: `aria-labelledby`, `aria-label`, `<label>`, the
     field's own wrapper, placeholder, then `name`.

  Further rules:
  - Long questions that merely mention "employer" or "country" don't count
    as that field.
  - Open shadow roots are searched.
  - Radio groups read their legend.
  - Searchable dropdowns (`aria-autocomplete`) are typed into, then the
    matching option is clicked.

- **Filling** (`src/autofill/fill.ts`):
  - fills only empty fields, setting values the way typing does so React,
    Angular and Vue notice;
  - marks each filled field with a soft outline;
  - matches saved answers by wording, ignoring company names;
  - picks options by text, and yes/no by meaning.
- **Never filled:**
  - questions about gender, race or ethnicity, veteran status, disability,
    age or date of birth, sexuality, religion, Indigenous status, or
    criminal history;
  - identity numbers, bank or card details, and passwords;
  - file uploads (the popup reminds you to attach your résumé);
  - anything already typed.

  **Nothing is ever submitted.** The popup lists what's left for you, and
  why.

- **Plan:** Advanced, checked in `AutofillService`. Builds without accounts
  aren't limited, as with other plan gates.

## Consequences

- **No new permissions**, and nothing runs on pages until the user clicks.
- **Some searchable dropdowns ignore scripted input.** Greenhouse's do;
  checked live on 2026-10-02. Opening them would need the `debugger`
  permission, which we won't take. They're reported as "choose this one
  yourself", after a 300 ms check rather than a long wait.
- **Fixtures:**
  - Greenhouse, Lever and Ashby are live captures (`scripts/snapshot-form.ts`),
    with company names made fictional.
  - Workday sits behind a candidate sign-in, and SmartRecruiters refuses
    automated browsers, so their fixtures are hand-built from documented
    attributes and marked as such.
  - A generic careers-page fixture covers the general rules.
- **Profile changes need an owner:** adding a profile field means a schema
  field, a rule, the dialog and a fixture case.

## Alternatives considered

| Option                                             | Why not                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A persistent content script that offers to fill    | Needs host permissions on every recruiting system, and runs on pages the user never asked about          |
| Sync the profile                                   | More personal data on our server for a small convenience; can be revisited with the encrypted vault idea |
| Store and attach the résumé file                   | Large files in extension storage and file-input tricks; the "documents" feature tracks file names only   |
| An AI model to understand questions                | Excluded by requirement; deterministic rules plus saved answers cover the common questions               |
| The `debugger` permission for trusted input events | A powerful, scary permission for a few dropdowns                                                         |
