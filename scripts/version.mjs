#!/usr/bin/env node
// Usage: node scripts/version.mjs   prints the extension version (version-name in metadata.json).
import { readFileSync } from 'node:fs'

const metadata = JSON.parse(readFileSync(new URL('../gnome-extension/metadata.json', import.meta.url), 'utf8'))
console.log(metadata['version-name'])
