import type { Posting, Priority, WorkplaceType } from '@/domain/job';
import type { StageId } from '@/domain/stage';
import { formatSalary, parseSalaryText, type ExtractionResult } from '@/extraction';

/** Editable state of the capture form, and its mapping to/from the domain. */
export interface Draft {
  title: string;
  company: string;
  location: string;
  workplaceType: WorkplaceType | '';
  salaryText: string;
  stageId: StageId;
  priority: Priority;
  notes: string;
}

export function draftFromResult(result: ExtractionResult, stageId: StageId): Draft {
  const f = result.fields;
  return {
    title: f.title ?? '',
    company: f.company ?? '',
    location: f.location ?? '',
    workplaceType: f.workplaceType ?? '',
    salaryText: formatSalary(f.salary) ?? '',
    stageId,
    priority: 0,
    notes: '',
  };
}

export function emptyDraft(stageId: StageId, title = ''): Draft {
  return {
    title,
    company: '',
    location: '',
    workplaceType: '',
    salaryText: '',
    stageId,
    priority: 0,
    notes: '',
  };
}

/** Converts the edited draft into posting overrides; untouched salary keeps its structured form. */
export function postingFromDraft(draft: Draft, result?: ExtractionResult): Posting {
  const original = result?.fields.salary;
  const salaryUnchanged =
    original !== undefined && draft.salaryText === (formatSalary(original) ?? '');
  const salary = salaryUnchanged
    ? original
    : draft.salaryText.trim()
      ? parseSalaryText(draft.salaryText, original?.currency)
      : undefined;
  const posting: Posting = {
    title: draft.title.trim() || 'Untitled position',
    company: draft.company.trim(),
    employmentTypes: result?.fields.employmentTypes ?? [],
  };
  if (draft.location.trim()) posting.location = draft.location.trim();
  if (draft.workplaceType) posting.workplaceType = draft.workplaceType;
  if (salary) posting.salary = salary;
  return posting;
}
