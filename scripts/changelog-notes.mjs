#!/usr/bin/env node
// Usage: node scripts/changelog-notes.mjs <version>   prints the CHANGELOG section of that version.
import { readFileSync } from 'node:fs'
import { changelogNotes } from './release-lib.mjs'

const version = process.argv[2]
if (!version) {
  console.error('usage: changelog-notes.mjs <version>')
  process.exit(1)
}
const notes = changelogNotes(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version)
if (!notes) {
  console.error(`CHANGELOG.md has no entries for ${version}`)
  process.exit(1)
}
console.log(notes)
