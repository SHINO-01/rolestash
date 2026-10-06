import { JobSchema, type Job, type JobId } from '@/domain/job';
import { normalizeJob } from '@/domain/retired-stages';
import type { KeyValueStore } from './key-value-store';
import { isJobKey, jobKey, SYNC_DELETIONS_KEY } from './keys';

/** Deletion times kept for sync; the oldest go first past this many. */
const MAX_DELETIONS = 1000;

/**
 * Persistence for Job aggregates. Validates on write (so invariants hold at the
 * boundary) and tolerates bad records on read (so one corrupt entry never
 * takes the whole board down). Jobs on retired columns are mapped to their
 * new ones (ADR-0034) both ways, so old ids never reach the board.
 */
export class JobRepository {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<Job[]> {
    const all = await this.store.get(null);
    const jobs: Job[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!isJobKey(key)) continue;
      const parsed = JobSchema.safeParse(value);
      if (parsed.success) jobs.push(normalizeJob(parsed.data));
      else console.warn(`[rolestash] Skipping invalid record ${key}`, parsed.error.issues);
    }
    return jobs;
  }

  async get(id: JobId): Promise<Job | undefined> {
    const key = jobKey(id);
    const result = await this.store.get([key]);
    const parsed = JobSchema.safeParse(result[key]);
    return parsed.success ? normalizeJob(parsed.data) : undefined;
  }

  async save(job: Job): Promise<Job> {
    const [saved] = await this.saveMany([job]);
    if (!saved) throw new Error('Save failed');
    return saved;
  }

  /** Writes all jobs in a single storage call (atomic from chrome.storage's view). */
  async saveMany(jobs: readonly Job[]): Promise<Job[]> {
    const valid = jobs.map((job) => normalizeJob(JobSchema.parse(job)));
    await this.store.set(Object.fromEntries(valid.map((job) => [jobKey(job.id), job])));
    return valid;
  }

  /**
   * Removes a job. A user's deletion passes `deletedAt`, which is kept so
   * sync can stamp the tombstone with when it happened (ADR-0016).
   */
  async delete(id: JobId, deletedAt?: string): Promise<void> {
    await this.store.remove([jobKey(id)]);
    if (deletedAt === undefined) return;
    const log = { ...(await this.deletions()), [id]: deletedAt };
    const kept = Object.entries(log)
      .sort(([, x], [, y]) => (x < y ? 1 : x > y ? -1 : 0))
      .slice(0, MAX_DELETIONS);
    await this.store.set({ [SYNC_DELETIONS_KEY]: Object.fromEntries(kept) });
  }

  /** When jobs were deleted on this device: jobId → ISO time. */
  async deletions(): Promise<Record<string, string>> {
    const raw = (await this.store.get([SYNC_DELETIONS_KEY]))[SYNC_DELETIONS_KEY];
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  }

  async forgetDeletions(ids: readonly string[]): Promise<void> {
    const log = await this.deletions();
    if (!ids.some((id) => id in log)) return;
    for (const id of ids) Reflect.deleteProperty(log, id);
    await this.store.set({ [SYNC_DELETIONS_KEY]: log });
  }

  async deleteAll(): Promise<void> {
    const all = await this.store.get(null);
    await this.store.remove(Object.keys(all).filter(isJobKey));
  }

  /** Notifies when any job changes, from any extension context. */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe((changes) => {
      if (Object.keys(changes).some(isJobKey)) listener();
    });
  }
}
