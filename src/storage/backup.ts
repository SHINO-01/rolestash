import { z } from 'zod';
import { JobSchema, type Job } from '@/domain/job';
import { SettingsSchema } from '@/domain/settings';
import type { JobRepository } from './job-repository';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import type { SettingsRepository } from './settings-repository';

/**
 * JSON backup format. With no backend, export/import *is* the backup and
 * device-transfer story, so the format is versioned and strictly validated.
 */
export const BACKUP_FORMAT = 'rolestash-backup';
/** Backups exported before the rename to Rolestash. Same shape. */
const LEGACY_BACKUP_FORMATS: readonly string[] = ['jobtrail-backup'];

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.iso.datetime({ offset: true }),
  settings: SettingsSchema,
  jobs: z.array(JobSchema),
});
export type Backup = z.infer<typeof BackupSchema>;

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export async function createBackup(
  jobs: JobRepository,
  settings: SettingsRepository,
  now: Date = new Date(),
): Promise<Backup> {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    settings: await settings.get(),
    jobs: await jobs.list(),
  };
}

/**
 * Upgrade hook for backups written by older builds. When a storage migration
 * changes record shapes, add the matching transformation here too.
 */
function upgradeBackup(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
}

export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) throw new BackupError('Unrecognised backup file.');
  const record = raw as Record<string, unknown>;
  if (typeof record.format === 'string' && LEGACY_BACKUP_FORMATS.includes(record.format))
    record.format = BACKUP_FORMAT;
  if (record.format !== BACKUP_FORMAT)
    throw new BackupError('This is not a Rolestash backup file.');
  if (typeof record.schemaVersion === 'number' && record.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new BackupError('This backup was made by a newer version of Rolestash. Update first.');
  }
  const parsed = BackupSchema.safeParse(upgradeBackup(record));
  if (!parsed.success) {
    throw new BackupError(
      'The backup file is damaged or incomplete.',
      parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return parsed.data;
}

export async function restoreBackup(
  backup: Backup,
  mode: ImportMode,
  jobs: JobRepository,
  settings: SettingsRepository,
): Promise<ImportSummary> {
  const existing = new Map((await jobs.list()).map((j) => [j.id, j]));
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0, removed: 0 };
  const toWrite: Job[] = [];

  if (mode === 'replace') {
    summary.removed = existing.size;
    await jobs.deleteAll();
    await settings.replace(backup.settings);
    toWrite.push(...backup.jobs);
    summary.added = backup.jobs.length;
  } else {
    // Merge: newest `updatedAt` wins per job id; settings are left alone.
    for (const incoming of backup.jobs) {
      const current = existing.get(incoming.id);
      if (!current) {
        toWrite.push(incoming);
        summary.added++;
      } else if (incoming.updatedAt > current.updatedAt) {
        toWrite.push(incoming);
        summary.updated++;
      } else {
        summary.skipped++;
      }
    }
    // Jobs referencing stages this board doesn't have land in the default stage.
    const current = await settings.get();
    const known = new Set(current.stages.map((s) => s.id));
    for (const job of toWrite) {
      if (!known.has(job.stageId)) job.stageId = current.defaultStageId;
    }
  }

  if (toWrite.length > 0) await jobs.saveMany(toWrite);
  return summary;
}
