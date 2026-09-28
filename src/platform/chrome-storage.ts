import { browser } from 'wxt/browser';
import type { KeyValueStore, StorageChanges } from '@/storage/key-value-store';

/** `chrome.storage.local` implementation of the persistence port. */
export class ChromeKeyValueStore implements KeyValueStore {
  private readonly area = browser.storage.local;

  async get(keys: string[] | null): Promise<Record<string, unknown>> {
    return await this.area.get(keys);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.area.set(items);
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length > 0) await this.area.remove(keys);
  }

  subscribe(listener: (changes: StorageChanges) => void): () => void {
    const handler = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ): void => {
      if (areaName === 'local') listener(changes);
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }
}
