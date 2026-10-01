import type { ExtractionResult } from '@/extraction';
import type {
  DeviceRegistration,
  EmailEventRow,
  InboxInfo,
  PulledChange,
  RemoteDevice,
  SyncChange,
} from './backend/supabase-client';

/**
 * Ports the service layer depends on. Implementations live in src/platform
 * (real browser APIs) and tests/ (fakes).
 */

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
}

export interface ExtractorRunner {
  /** One result per frame the extractor could run in. */
  run(tabId: number): Promise<ExtractionResult[]>;
  /** Raw page HTML — used by the "download fixture" developer tool. */
  snapshot(tabId: number): Promise<PageSnapshot>;
}

/** The server side of sync (ADR-0016), already bound to the signed-in user. */
export interface RemoteJobStore {
  registerDevice(device: {
    id: string;
    name: string;
    kind: RemoteDevice['kind'];
  }): Promise<DeviceRegistration>;
  listDevices(): Promise<RemoteDevice[]>;
  removeDevice(id: string): Promise<void>;
  push(deviceId: string, changes: SyncChange[]): Promise<number>;
  pull(deviceId: string, after: number, limit: number): Promise<PulledChange[]>;
}

/** The server side of email updates (ADR-0014), bound to the signed-in user. */
export interface EmailInbox {
  /** The forwarding address; `rotate` replaces it first. */
  address(rotate?: boolean): Promise<InboxInfo>;
  events(after: number, limit: number): Promise<EmailEventRow[]>;
  remove(ids: readonly number[]): Promise<void>;
}

/** Loads a pasted job link (Pro; capture from a link). */
export interface PageLoader {
  /** Fetches the page's HTML without cookies; `url` is the final URL after redirects. */
  fetch(url: string): Promise<{ url: string; html: string }>;
  /** Opens the page in a background tab, runs the extractor once it has rendered, closes it. */
  render(url: string): Promise<ExtractionResult[]>;
}

/** System notifications (chrome.notifications, optional permission; ADR-0015). */
export interface Notifier {
  /** Whether the user has granted notifications. */
  granted(): Promise<boolean>;
  /** Shows (or replaces) the notification with this id. */
  notify(id: string, title: string, message: string): Promise<void>;
}

/** Browser-driven OAuth (chrome.identity.launchWebAuthFlow in production). */
export interface WebAuthFlow {
  /** Where the provider redirects back to, e.g. https://<id>.chromiumapp.org/ */
  redirectUrl(): string;
  /** Opens `url` for the user and resolves with the final redirect URL. */
  launch(url: string): Promise<string>;
}
