import type { Settings } from '@/domain/settings';
import type { Stage } from '@/domain/stage';

/** The seven default columns of 0.4.7 and earlier, before ADR-0034. */
export const LEGACY_STAGES: readonly Stage[] = [
  { id: 'saved', name: 'Saved', color: 'slate', kind: 'active', marksApplied: false },
  { id: 'applied', name: 'Applied', color: 'sky', kind: 'active', marksApplied: true },
  { id: 'screening', name: 'Screening', color: 'violet', kind: 'active', marksApplied: true },
  { id: 'interviewing', name: 'Interviewing', color: 'amber', kind: 'active', marksApplied: true },
  { id: 'offer', name: 'Offer', color: 'emerald', kind: 'won', marksApplied: true },
  { id: 'rejected', name: 'Rejected', color: 'rose', kind: 'lost', marksApplied: false },
  { id: 'withdrawn', name: 'Withdrawn', color: 'zinc', kind: 'lost', marksApplied: false },
];

export const LEGACY_SETTINGS: Settings = {
  stages: [...LEGACY_STAGES],
  defaultStageId: 'saved',
  theme: 'system',
};
