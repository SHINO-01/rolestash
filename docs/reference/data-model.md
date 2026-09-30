# Data model

Source of truth: zod schemas in `src/domain/`. TypeScript types are inferred
from them. This page explains intent; the code defines shape.

## Job (`domain/job.ts`)

| Field                    | Type                                                                                                        | Notes                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | string (UUID)                                                                                               | Immutable                                                                                                                                |
| `title`                  | string (1–300)                                                                                              | Required; "Untitled position" fallback                                                                                                   |
| `company`                | string (≤200)                                                                                               | May be empty                                                                                                                             |
| `location`               | string?                                                                                                     | Free text, up to three locations joined with `; `                                                                                        |
| `workplaceType`          | `onsite \| hybrid \| remote`?                                                                               |                                                                                                                                          |
| `employmentTypes`        | array of `full-time`, `part-time`, `contract`, `temporary`, `casual`, `internship`, `graduate`, `volunteer` |                                                                                                                                          |
| `salary`                 | `{ min?, max?, currency?, period?, text? }`?                                                                | `currency` is ISO 4217 or absent (never guessed); `period` is `hour \| day \| week \| month \| year`                                     |
| `postedAt`, `closesAt`   | ISO date or datetime?                                                                                       | Date-only strings are calendar dates (no timezone)                                                                                       |
| `description`            | string? (≤100k)                                                                                             | Plain text snapshot (ADR-0005)                                                                                                           |
| `externalId`             | string?                                                                                                     | The site's own posting id                                                                                                                |
| `applyUrl`               | URL?                                                                                                        | Preferred by "Open posting" when present                                                                                                 |
| `stageId`                | string                                                                                                      | References `Settings.stages[].id`                                                                                                        |
| `rank`                   | number                                                                                                      | Order within stage (ADR-0006)                                                                                                            |
| `priority`               | 0–3                                                                                                         | Stars                                                                                                                                    |
| `tags`                   | string[] (≤30, each ≤40)                                                                                    |                                                                                                                                          |
| `notes`                  | string (≤50k)                                                                                               |                                                                                                                                          |
| `source`                 | `{ url, originalUrl, siteId, siteName, capturedAt }`                                                        | `url` is canonical (dedupe key). Manual jobs without a link use `https://rolestash.invalid/manual/<id>` (older jobs: `jobtrail.invalid`) |
| `extraction`             | `{ confidence, provenance, extractorVersion }`?                                                             | Absent for manual jobs                                                                                                                   |
| `activity`               | `Activity[]`                                                                                                | `created`, `stage_changed` (from/to), `edited` (fields; edits within 5 min coalesce)                                                     |
| `createdAt`, `updatedAt` | ISO datetime                                                                                                |                                                                                                                                          |
| `appliedAt`              | ISO datetime?                                                                                               | Stamped the first time the job enters a stage with `marksApplied`                                                                        |

## Stage (`domain/stage.ts`)

`{ id, name, color, kind: active|won|lost, marksApplied }`. Defaults: Saved,
Applied, Screening, Interviewing, Offer (won), Rejected (lost), Withdrawn
(lost). Stages are data in settings so column customisation needs no migration.

## Settings (`domain/settings.ts`)

`{ stages, defaultStageId, theme: system|light|dark }`. `defaultStageId` must
reference an existing stage (validated).

## ExtractionResult (`extraction/types.ts`)

Transient, never stored as-is: `{ url, originalUrl, site, fields, provenance,
confidence, isJobPage, warnings, extractorVersion, fromFrame? }`. Must remain
structured-clone-safe because it crosses `executeScript`.

## Backup (`storage/backup.ts`)

`{ format: 'rolestash-backup', schemaVersion, exportedAt, settings, jobs }`.
Import also accepts the pre-rename format `jobtrail-backup`.
