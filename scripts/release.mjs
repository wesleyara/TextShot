#!/usr/bin/env node
// Usage: make release-patch | release-minor | release-major   (or node scripts/release.mjs patch [--dry-run] [--yes])
//
// Run it on `develop`: it bumps `version-name` in gnome-extension/metadata.json, writes the CHANGELOG.md section
// (from the Conventional Commits since the last tag, plus anything already under [Unreleased]), commits, creates
// the annotated tag vX.Y.Z and pushes both. Opening and merging the develop -> main PR then publishes the GitHub
// release with the extension zip (.github/workflows/release.yml). Uploading to extensions.gnome.org stays manual.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { bumpVersion, changelogFromCommits, changelogNotes, rollChangelog } from './release-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const kind = args.find((a) => !a.startsWith('-'))
const dryRun = args.includes('--dry-run')
const assumeYes = args.includes('--yes')

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()
const fail = (message) => {
  console.error(`release: ${message}`)
  process.exit(1)
}

if (!['patch', 'minor', 'major'].includes(kind ?? '')) fail('usage: release.mjs patch|minor|major [--dry-run] [--yes]')

if (git('branch', '--show-current') !== 'develop') fail('releases are cut from develop. Check it out first.')
if (git('status', '--porcelain')) fail('the working tree is not clean. Commit or stash your changes.')
git('fetch', '--tags', 'origin')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/develop')) {
  fail('develop is not in sync with origin/develop. Pull or push first.')
}

const metadataPath = `${root}gnome-extension/metadata.json`
const metadataText = readFileSync(metadataPath, 'utf8')
const current = JSON.parse(metadataText)['version-name']
const next = bumpVersion(current, kind)
const tag = `v${next}`
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists`)

let lastTag = ''
try {
  lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  /* first release: every commit counts */
}
const subjects = git('log', '--no-merges', '--format=%s', lastTag ? `${lastTag}..HEAD` : 'HEAD').split('\n')
const generated = changelogFromCommits(subjects)

const changelogPath = `${root}CHANGELOG.md`
const changelog = readFileSync(changelogPath, 'utf8')
const date = new Date().toISOString().slice(0, 10)
let rolled
try {
  rolled = rollChangelog(changelog, next, date, generated)
} catch (err) {
  fail(err.message)
}

console.log(`\n${current} -> ${next} (${kind}), tag ${tag}, commits since ${lastTag || 'the start'}: ${subjects.length}\n`)
console.log(changelogNotes(rolled, next))
console.log('')

if (dryRun) {
  console.log('Dry run: nothing was changed.')
  process.exit(0)
}
if (!assumeYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`Commit, tag ${tag} and push develop? [y/N] `)).trim().toLowerCase()
  rl.close()
  if (answer !== 'y' && answer !== 'yes') fail('aborted')
}

writeFileSync(metadataPath, metadataText.replace(/("version-name":\s*")[^"]+(")/, `$1${next}$2`))
writeFileSync(changelogPath, rolled)
git('add', 'gnome-extension/metadata.json', 'CHANGELOG.md')
git('commit', '-m', `chore(release): ${tag}`)
git('tag', '-a', tag, '-m', `TextShot ${next}`)
git('push', '--atomic', 'origin', 'develop', tag)

console.log(`\n${tag} pushed on develop.`)
console.log('Next: open a PR develop -> main and merge it; the release is created from the tag.')
console.log('  gh pr create --base main --head develop --title "release: ' + tag + '"')
console.log('Then upload dist/textshot@wesleyara.shell-extension.zip (also attached to the release) to')
console.log('  https://extensions.gnome.org/upload/')
