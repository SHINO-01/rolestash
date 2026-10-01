# Application autofill

Advanced users save their details once (**Autofill profile…** on the board)
and fill application forms in one click (ADR-0020). This guide covers how a
form is read and filled, how to support a new form, and what's verified.

## The parts

| Part                                | What it does                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `src/domain/profile.ts`             | `ProfileSchema`: every field optional, plus up to 30 saved answers  |
| `src/storage/profile-repository.ts` | The `profile` key: this device only, not synced, not backed up      |
| `src/autofill/fields.ts`            | Reads a form: controls, labels, which profile field each one is     |
| `src/autofill/fill.ts`              | Fills empty fields and reports what's left                          |
| `src/entrypoints/autofill.ts`       | The injected script; defines `__rolestashAutofill(profile)`         |
| `src/platform/autofill-runner.ts`   | Injects it on the `activeTab` grant, then calls it with the profile |
| `src/services/autofill-service.ts`  | Advanced gate, profile, merges the per-frame reports                |
| `src/features/autofill/`            | The profile dialog and the popup's **Fill this application** bar    |

The right-click menu item **Fill this application with Rolestash** runs the
same thing. The badge then shows how many fields were filled.

## How a question is recognised

In order, the first match wins:

1. **Never:** sensitive wording (gender, race, veteran status, disability,
   age, date of birth, sexuality, religion, Indigenous status, criminal
   history, identity numbers, bank or card details, passwords). These are
   reported as "never filled automatically".
2. **Per-system rules** (`ATS_RULES`), when the system is detected from the
   host, or from the markup for white-labelled forms.
3. **`autocomplete`**, such as `given-name`, `email`, `postal-code` or
   `organization`.
4. **Label wording** (`RULES`), with a maximum length per field
   (`MAX_WORDS`), so long questions that only mention "your current
   employer" aren't taken for the employer field.
5. **The field's `name` or `id`** (`first_name` → first name).

**Saved answers** are matched by shared words, at 70% or more, ignoring
capitalised words after the first (company names).

## How it's filled

- **Only empty fields.** Values are set through the native setter, followed
  by `input` and `change`, so frameworks see them.
- **Selects and radio groups:** the option is picked by its text, or by
  yes/no meaning.
- **Searchable dropdowns** (`aria-autocomplete="list"` / `role="combobox"`):
  - autofill types the value, waits for options in the listbox the field
    names, or in its own wrapper (never page-wide), and clicks the match;
  - if the dropdown doesn't open within 300 ms, it gives up and reports it.
- **Filled fields** get a soft green outline until focused.
- **Never touched:** file inputs (listed for the user), checkboxes and
  passwords. **Never submitted.**

## Verified against live forms (2026-10-02)

| System           | Fixture                                        | Live result                                                                                                                |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse       | `forms/greenhouse/live-2026-10` (live)         | Name, email, phone, LinkedIn, preferred name. Its searchable dropdowns ignore scripted input, so they're left for the user |
| Lever            | `forms/lever/live-2026-10` (live)              | Everything profile-backed, including location, links, yes/no work rights and "how did you hear"                            |
| Ashby            | `forms/ashby/live-2026-10` (live)              | Name, email, LinkedIn and the country dropdown                                                                             |
| Workday          | `forms/workday/my-information` (hand-built)    | Behind a candidate sign-in; built from documented `data-automation-id`s. Check on a real account                           |
| SmartRecruiters  | `forms/smartrecruiters/one-click` (hand-built) | Refuses automated browsers; built from its documented ids. Check by hand                                                   |
| Any careers page | `forms/generic/careers-page`                   | General rules, yes/no radios, selects, saved answers, sensitive questions, prefilled fields                                |

## Supporting a new form or fixing a miss

1. **Capture the form** (fictional names in, real names out; the
   replacement is case-sensitive, so pass each spelling):

   ```bash
   npx tsx scripts/snapshot-form.ts <ats> <case> <url> RealCo=Northwind realco=northwind
   ```

   It prints how each field reads.

2. **Fix the rule:** a selector in `ATS_RULES` for a system's own ids, or a
   wording rule in `RULES`. Prefer specific selectors.
3. **Add the fixture** to `FORM_FIXTURES` in `tests/unit/autofill/forms.ts`,
   and write `<case>.expected.json`. The fixture test compares every field:
   label, kind, key, sensitive and required.
4. **Run** `npx vitest run tests/unit/autofill`.
