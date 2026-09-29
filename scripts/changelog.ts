/**
 * Release helper. Runs directly on Node ≥22.18 (built-in TypeScript stripping),
 * so CI can use it without installing dependencies.
 *
 *   node scripts/changelog.ts release <patch|minor|major|x.y.z>   bump version + roll CHANGELOG
 *   node scripts/changelog.ts notes [version]                      print a version's release notes
 *   node scripts/changelog.ts check                                fail if the current version has no entry
 *
 * See docs/guides/releasing.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Bump = 'patch' | 'minor' | 'major';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** `bump` is a {@link Bump} keyword or an explicit x.y.z version. */
export function nextVersion(current: string, bump: string): string {
  if (SEMVER.test(bump)) {
    if (compareVersions(bump, current) <= 0)
      throw new Error(`${bump} is not greater than ${current}`);
    return bump;
  }
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`Current version "${current}" is not x.y.z`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump "${bump}" (use patch, minor, major or x.y.z)`);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const UNRELEASED = /^## \[Unreleased\][^\n]*\n/m;

/** Section body for a version (without its heading), or undefined. */
export function sectionFor(changelog: string, version: string): string | undefined {
  const escaped = version.replace(/\./g, '\\.');
  const start = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n`, 'm').exec(changelog);
  if (!start) return undefined;
  const rest = changelog.slice(start.index + start[0].length);
  const next = /^## \[/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** Turns the Unreleased section into a dated version section; leaves an empty Unreleased on top. */
export function rollChangelog(changelog: string, version: string, date: string): string {
  const match = UNRELEASED.exec(changelog);
  if (!match) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  if (sectionFor(changelog, version) !== undefined)
    throw new Error(`CHANGELOG already has ${version}`);
  const rest = changelog.slice(match.index + match[0].length);
  const nextHeading = /^## \[/m.exec(rest);
  const unreleasedBody = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
  if (!unreleasedBody) throw new Error('Nothing to release: the Unreleased section is empty');
  return (
    changelog.slice(0, match.index) +
    `## [Unreleased]\n\n## [${version}] — ${date}\n\n${unreleasedBody}\n\n` +
    (nextHeading ? rest.slice(nextHeading.index) : '')
  );
}

// ---------------------------------------------------------------- CLI

const root = resolve(fileURLToPath(import.meta.url), '../..');
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

function currentVersion(): string {
  return (JSON.parse(read('package.json')) as { version: string }).version;
}

function release(bump: string): void {
  const version = nextVersion(currentVersion(), bump);
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(resolve(root, 'CHANGELOG.md'), rollChangelog(read('CHANGELOG.md'), version, today));
  for (const file of ['package.json', 'package-lock.json']) {
    const json = JSON.parse(read(file)) as {
      version: string;
      packages?: Record<string, { version?: string }>;
    };
    json.version = version;
    const rootPackage = json.packages?.[''];
    if (rootPackage) rootPackage.version = version;
    writeFileSync(resolve(root, file), `${JSON.stringify(json, null, 2)}\n`);
  }
  console.log(`Prepared v${version}. Commit ("chore(release): v${version}") and push to dev.`);
}

function main(args: string[]): void {
  const [command, arg] = args;
  if (command === 'release' && arg) {
    release(arg);
    return;
  }
  if (command === 'notes') {
    const version = arg ?? currentVersion();
    const notes = sectionFor(read('CHANGELOG.md'), version);
    if (notes === undefined) throw new Error(`CHANGELOG.md has no entry for ${version}`);
    console.log(notes);
    return;
  }
  if (command === 'check') {
    const version = currentVersion();
    if (sectionFor(read('CHANGELOG.md'), version) === undefined) {
      throw new Error(
        `CHANGELOG.md has no "## [${version}]" entry for the current package version`,
      );
    }
    return;
  }
  throw new Error('Usage: node scripts/changelog.ts <release <bump>|notes [version]|check>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
