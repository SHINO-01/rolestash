import { createServices, type Services } from '@/services/container';
import { ChromeKeyValueStore } from './chrome-storage';
import { ScriptingExtractorRunner } from './extractor-runner';

let instance: Services | undefined;

/** Lazily-built singleton wired to real browser APIs. */
export function getServices(): Services {
  instance ??= createServices(new ChromeKeyValueStore(), new ScriptingExtractorRunner());
  return instance;
}
