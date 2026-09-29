import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareVersions, nextVersion, rollChangelog, sectionFor } from '../../scripts/changelog';

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- SEEK salary selector

## [0.1.0] — 2026-09-29

### Added

- First release
`;

describe('release helper', () => {
  it('computes the next version', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(nextVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(nextVersion('0.9.3', 'major')).toBe('1.0.0');
    expect(nextVersion('0.1.0', '0.3.0')).toBe('0.3.0');
    expect(() => nextVersion('0.3.0', '0.2.0')).toThrow(/not greater/);
    expect(() => nextVersion('0.1.0', 'huge')).toThrow(/Unknown bump/);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('rolls Unreleased into a dated version section', () => {
    const rolled = rollChangelog(CHANGELOG, '0.1.1', '2026-10-01');
    expect(rolled).toContain(
      '## [Unreleased]\n\n## [0.1.1] — 2026-10-01\n\n### Fixed\n\n- SEEK salary selector\n\n## [0.1.0]',
    );
    expect(sectionFor(rolled, '0.1.1')).toBe('### Fixed\n\n- SEEK salary selector');
    expect(sectionFor(rolled, '0.1.0')).toBe('### Added\n\n- First release');
    expect(sectionFor(rolled, '9.9.9')).toBeUndefined();
  });

  it('refuses empty or duplicate releases', () => {
    const empty = CHANGELOG.replace('### Fixed\n\n- SEEK salary selector\n\n', '');
    expect(() => rollChangelog(empty, '0.1.1', '2026-10-01')).toThrow(/Nothing to release/);
    expect(() => rollChangelog(CHANGELOG, '0.1.0', '2026-10-01')).toThrow(/already has/);
    expect(() => rollChangelog('# Changelog\n', '0.1.1', '2026-10-01')).toThrow(/Unreleased/);
  });

  it('the committed CHANGELOG has an entry for the current package version', () => {
    const root = resolve(import.meta.dirname, '../..');
    const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(sectionFor(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), version)).toBeTruthy();
  });
});
