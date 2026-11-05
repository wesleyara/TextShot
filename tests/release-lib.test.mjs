// node --test tests/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bumpVersion, changelogFromCommits, changelogNotes, rollChangelog, unreleasedBody } from '../scripts/release-lib.mjs'

const CHANGELOG = `# Changelog

## [Unreleased]

### Added
- Something new.

## [0.1.0] - 2026-01-01

First version.
`

describe('bumpVersion', () => {
  it('bumps each part and resets the lower ones', () => {
    assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4')
    assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0')
    assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0')
    assert.equal(bumpVersion('0.0.0', 'major'), '1.0.0')
  })

  it('rejects unknown kinds and non plain versions', () => {
    assert.throws(() => bumpVersion('1.2.3', 'huge'))
    assert.throws(() => bumpVersion('1.2.3-beta.1', 'patch'))
    assert.throws(() => bumpVersion('1.0', 'patch'))
  })
})

describe('changelog', () => {
  it('reads the unreleased body', () => {
    assert.equal(unreleasedBody(CHANGELOG), '### Added\n- Something new.')
  })

  it('rolls Unreleased under the new version and keeps an empty Unreleased', () => {
    const rolled = rollChangelog(CHANGELOG, '0.2.0', '2026-02-02')
    assert.ok(rolled.includes('## [Unreleased]\n\n## [0.2.0] - 2026-02-02\n\n### Added\n- Something new.'))
    assert.equal(unreleasedBody(rolled), '')
    assert.ok(rolled.includes('## [0.1.0] - 2026-01-01'))
  })

  it('refuses to release when there is nothing at all', () => {
    const empty = rollChangelog(CHANGELOG, '0.2.0', '2026-02-02')
    assert.throws(() => rollChangelog(empty, '0.2.1', '2026-02-03'), /Nothing/)
    assert.throws(() => rollChangelog(empty, '0.2.1', '2026-02-03', ''), /Nothing/)
  })

  it('merges generated entries with the manual ones', () => {
    const rolled = rollChangelog(CHANGELOG, '0.2.0', '2026-02-02', '### Fixed\n- **ocr:** x')
    assert.equal(changelogNotes(rolled, '0.2.0'), '### Added\n- Something new.\n\n### Fixed\n- **ocr:** x')
    const onlyGenerated = rollChangelog(rolled, '0.2.1', '2026-02-03', '### Added\n- y')
    assert.equal(changelogNotes(onlyGenerated, '0.2.1'), '### Added\n- y')
    assert.ok(onlyGenerated.includes('## [0.2.0] - 2026-02-02'))
  })

  it('extracts the notes of one version only', () => {
    assert.equal(changelogNotes(CHANGELOG, '0.1.0'), 'First version.')
    assert.equal(changelogNotes(rollChangelog(CHANGELOG, '0.2.0', '2026-02-02'), '0.2.0'), '### Added\n- Something new.')
    assert.equal(changelogNotes(CHANGELOG, '9.9.9'), null)
  })
})

describe('changelogFromCommits', () => {
  it('groups Conventional Commits and skips housekeeping', () => {
    const out = changelogFromCommits([
      'feat(prefs): storage page',
      'fix(ocr): keep line breaks',
      'fix(ocr): keep line breaks',
      'refactor: split lib.js',
      'perf(capture): skip the upscale on large areas',
      'docs: update the readme',
      'test: cover the release helpers',
      'chore(release): v0.2.0',
      'feat(schema)!: rename the languages key',
      'not a conventional commit',
    ])
    assert.equal(out, [
      '### Breaking changes\n- **schema:** rename the languages key',
      '### Added\n- **prefs:** storage page',
      '### Fixed\n- **ocr:** keep line breaks',
      '### Performance\n- **capture:** skip the upscale on large areas',
      '### Changed\n- split lib.js',
    ].join('\n\n'))
  })

  it('returns an empty string when nothing is user facing', () => {
    assert.equal(changelogFromCommits(['docs: x', 'ci: y', 'chore(release): v1.0.0']), '')
  })
})

describe('metadata.json', () => {
  it('has a plain semver version-name that EGO accepts', async () => {
    const { readFileSync } = await import('node:fs')
    const meta = JSON.parse(readFileSync(new URL('../gnome-extension/metadata.json', import.meta.url), 'utf8'))
    assert.match(meta['version-name'], /^\d+\.\d+\.\d+$/)
    assert.equal(meta.version, undefined, 'the "version" field is set by extensions.gnome.org')
  })
})
