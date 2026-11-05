// SPDX-License-Identifier: GPL-2.0-or-later
// Pure helpers of the release flow, shared by scripts/release.mjs, the release workflow and the tests.

/** `1.2.3` + `minor` -> `1.3.0`. Pre-release versions are not supported on purpose. */
export function bumpVersion(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`Not a plain semver version: ${version}`)
  const [major, minor, patch] = m.slice(1).map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown release kind: ${kind} (use patch, minor or major)`)
}

const UNRELEASED = /^## \[Unreleased\][^\n]*\n/m

/** The body under `## [Unreleased]`, trimmed. */
export function unreleasedBody(changelog) {
  const start = UNRELEASED.exec(changelog)
  if (!start) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  const from = start.index + start[0].length
  const next = changelog.slice(from).search(/^## \[/m)
  return changelog.slice(from, next === -1 ? undefined : from + next).trim()
}

const GROUPS = [
  ['feat', 'Added'],
  ['fix', 'Fixed'],
  ['perf', 'Performance'],
  ['refactor', 'Changed'],
]

/**
 * Changelog entries from Conventional Commit subjects: feat -> Added, fix -> Fixed, perf -> Performance,
 * refactor -> Changed, and `!` / BREAKING CHANGE -> Breaking changes. docs, test, build, ci, chore and release
 * commits are left out. Returns Markdown, or an empty string when nothing is worth listing.
 */
export function changelogFromCommits(subjects) {
  const buckets = new Map()
  const push = (title, line) => {
    const list = buckets.get(title) ?? []
    if (!list.includes(line)) list.push(line)
    buckets.set(title, list)
  }
  for (const raw of subjects) {
    const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(raw.trim())
    if (!m) continue
    const [, type, scope, bang, text] = m
    if (type === 'chore' && /^release\b/i.test(scope ?? '')) continue
    const line = `- ${scope ? `**${scope}:** ` : ''}${text}`
    if (bang) push('Breaking changes', line)
    else {
      const group = GROUPS.find(([t]) => t === type)
      if (group) push(group[1], line)
    }
  }
  const order = ['Breaking changes', ...GROUPS.map(([, title]) => title)]
  return [...new Set(order)]
    .filter((title) => buckets.has(title))
    .map((title) => `### ${title}\n${buckets.get(title).join('\n')}`)
    .join('\n\n')
}

/**
 * Moves the Unreleased entries, plus `generated` ones (see changelogFromCommits), under `## [version] - date`
 * and leaves an empty Unreleased section. Throws when there is nothing to release.
 */
export function rollChangelog(changelog, version, date, generated = '') {
  const manual = unreleasedBody(changelog)
  const body = [manual, generated.trim()].filter(Boolean).join('\n\n')
  if (!body) {
    throw new Error('Nothing to release: no entries under "## [Unreleased]" and no feat/fix commits since the last tag')
  }
  const start = UNRELEASED.exec(changelog)
  const from = start.index + start[0].length
  const next = changelog.slice(from).search(/^## \[/m)
  const rest = next === -1 ? '' : changelog.slice(from + next)
  return `${changelog.slice(0, start.index)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n${rest}`.replace(/\n+$/, '\n')
}

/** The notes of one version, or null when the changelog has no such section. */
export function changelogNotes(changelog, version) {
  const escaped = version.replace(/\./g, '\\.')
  const head = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n`, 'm').exec(changelog)
  if (!head) return null
  const from = head.index + head[0].length
  const next = changelog.slice(from).search(/^## \[/m)
  const body = changelog.slice(from, next === -1 ? undefined : from + next).trim()
  return body || null
}
