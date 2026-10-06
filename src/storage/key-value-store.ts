/**
 * Minimal persistence port. Repositories depend on this interface, never on
 * `chrome.storage` directly, so they run unchanged in unit tests and could be
 * moved to IndexedDB (or a sync backend) by writing one new adapter.
 */
export type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;

export interface KeyValueStore {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Fires for writes from *any* extension context (widget, board, background). */
  subscribe(listener: (changes: StorageChanges) => void): () => void;
}

/** In-memory implementation used by tests. Mirrors chrome.storage semantics (structured clone). */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();
  private readonly listeners = new Set<(changes: StorageChanges) => void>();

  constructor(initial: Record<string, unknown> = {}) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, structuredClone(v));
  }

  get(keys: string[] | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const wanted = keys ?? [...this.data.keys()];
    for (const key of wanted) {
      if (this.data.has(key)) out[key] = structuredClone(this.data.get(key));
    }
    return Promise.resolve(out);
  }

  set(items: Record<string, unknown>): Promise<void> {
    const changes: StorageChanges = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: this.data.get(key), newValue: structuredClone(value) };
      this.data.set(key, structuredClone(value));
    }
    this.emit(changes);
    return Promise.resolve();
  }

  remove(keys: string[]): Promise<void> {
    const changes: StorageChanges = {};
    for (const key of keys) {
      if (!this.data.has(key)) continue;
      changes[key] = { oldValue: this.data.get(key) };
      this.data.delete(key);
    }
    this.emit(changes);
    return Promise.resolve();
  }

  subscribe(listener: (changes: StorageChanges) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(changes: StorageChanges): void {
    if (Object.keys(changes).length === 0) return;
    for (const l of this.listeners) l(changes);
  }
}
