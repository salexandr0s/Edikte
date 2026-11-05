// @ts-check
/**
 * Fails when a release tag does not name the version in package.json.
 *
 * Usage: node scripts/check-release-version.mjs <tag>, for example v0.1.0
 */
import { readFile } from 'node:fs/promises'

const tag = process.argv[2]
if (tag === undefined) {
  console.error('Usage: node scripts/check-release-version.mjs <tag>')
  process.exit(2)
}

/** @type {unknown} */
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version =
  typeof manifest === 'object' &&
  manifest !== null &&
  'version' in manifest &&
  typeof manifest.version === 'string'
    ? manifest.version
    : null

if (version === null) {
  console.error('::error::package.json has no version')
  process.exit(1)
}
if (tag !== `v${version}`) {
  console.error(`::error::Tag ${tag} does not match version ${version} in package.json`)
  process.exit(1)
}
console.log(`Tag ${tag} matches version ${version} in package.json`)
