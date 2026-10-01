import { z } from 'zod';
import { DEFAULT_STAGE_ID, DEFAULT_STAGES, StageSchema } from './stage';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const SettingsSchema = z
  .object({
    stages: z.array(StageSchema).min(1),
    /** Stage that new captures land in. */
    defaultStageId: z.string().min(1),
    theme: z.enum(THEMES),
    /** Daily "closing soon" notification (Pro; ADR-0015). Absent means on. */
    closingAlerts: z.boolean().optional(),
  })
  .refine((s) => s.stages.some((stage) => stage.id === s.defaultStageId), {
    message: 'defaultStageId must reference an existing stage',
    path: ['defaultStageId'],
  });
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  stages: [...DEFAULT_STAGES],
  defaultStageId: DEFAULT_STAGE_ID,
  theme: 'system',
};
