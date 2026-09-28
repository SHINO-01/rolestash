import { JobSchema, type Job, type JobId } from '@/domain/job';
import type { KeyValueStore } from './key-value-store';
import { isJobKey, jobKey } from './keys';

/**
 * Persistence for Job aggregates. Validates on write (so invariants hold at the
 * boundary) and tolerates bad records on read (so one corrupt entry never
 * takes the whole board down).
 */
export class JobRepository {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<Job[]> {
    const all = await this.store.get(null);
    const jobs: Job[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!isJobKey(key)) continue;
      const parsed = JobSchema.safeParse(value);
      if (parsed.success) jobs.push(parsed.data);
      else console.warn(`[jobtrail] Skipping invalid record ${key}`, parsed.error.issues);
    }
    return jobs;
  }

  async get(id: JobId): Promise<Job | undefined> {
    const key = jobKey(id);
    const result = await this.store.get([key]);
    const parsed = JobSchema.safeParse(result[key]);
    return parsed.success ? parsed.data : undefined;
  }

  async save(job: Job): Promise<Job> {
    const [saved] = await this.saveMany([job]);
    if (!saved) throw new Error('Save failed');
    return saved;
  }

  /** Writes all jobs in a single storage call (atomic from chrome.storage's view). */
  async saveMany(jobs: readonly Job[]): Promise<Job[]> {
    const valid = jobs.map((job) => JobSchema.parse(job));
    await this.store.set(Object.fromEntries(valid.map((job) => [jobKey(job.id), job])));
    return valid;
  }

  async delete(id: JobId): Promise<void> {
    await this.store.remove([jobKey(id)]);
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
