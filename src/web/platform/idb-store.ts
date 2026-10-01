import type { KeyValueStore, StorageChanges } from '@/storage/key-value-store';

/**
 * KeyValueStore for the web board (ADR-0017), on IndexedDB so it holds far
 * more than localStorage's 5 MB. Values are structured-cloned, like
 * chrome.storage. A BroadcastChannel tells other tabs about writes, so
 * subscribe() behaves like chrome.storage.onChanged.
 */
const STORE = 'kv';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbKeyValueStore implements KeyValueStore {
  private readonly db: Promise<IDBDatabase>;
  private readonly listeners = new Set<(changes: StorageChanges) => void>();
  private readonly channel: BroadcastChannel;

  constructor(name = 'rolestash') {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    this.db = request(open);
    this.channel = new BroadcastChannel(`${name}:changes`);
    this.channel.onmessage = (event: MessageEvent<StorageChanges>) => this.emit(event.data);
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db).transaction(STORE, mode).objectStore(STORE);
  }

  async get(keys: string[] | null): Promise<Record<string, unknown>> {
    const store = await this.tx('readonly');
    const out: Record<string, unknown> = {};
    if (keys === null) {
      const [allKeys, values] = await Promise.all([
        request(store.getAllKeys()),
        request(store.getAll()),
      ]);
      allKeys.forEach((k, i) => {
        out[typeof k === 'string' ? k : JSON.stringify(k)] = values[i] as unknown;
      });
      return out;
    }
    const values = await Promise.all(keys.map((k) => request(store.get(k))));
    keys.forEach((k, i) => {
      if (values[i] !== undefined) out[k] = values[i];
    });
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const before = await this.get(Object.keys(items));
    const store = await this.tx('readwrite');
    await Promise.all(Object.entries(items).map(([k, v]) => request(store.put(v, k))));
    const changes: StorageChanges = Object.fromEntries(
      Object.entries(items).map(([k, v]) => [k, { oldValue: before[k], newValue: v }]),
    );
    this.publish(changes);
  }

  async remove(keys: string[]): Promise<void> {
    const before = await this.get(keys);
    const store = await this.tx('readwrite');
    await Promise.all(keys.map((k) => request(store.delete(k))));
    this.publish(Object.fromEntries(keys.map((k) => [k, { oldValue: before[k] }])));
  }

  subscribe(listener: (changes: StorageChanges) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(changes: StorageChanges): void {
    if (Object.keys(changes).length === 0) return;
    this.emit(changes);
    this.channel.postMessage(changes);
  }

  private emit(changes: StorageChanges): void {
    for (const listener of this.listeners) listener(changes);
  }
}
