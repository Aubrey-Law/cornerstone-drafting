#!/usr/bin/env node
/**
 * Emit the production manifest from the development one.
 *
 * One template, not two files kept in step by hand: every requirement set,
 * permission and ribbon control is shared, and the only real differences are
 * the origin the pane is served from and the add-in's identity. Two hand-edited
 * XML files drift, and the way you find out is an attorney's Word.
 *
 * Usage: node scripts/manifest.mjs [--origin=https://…] [--out=manifest.prod.xml] [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(here, '../manifest.xml')
const DEFAULT_OUT = resolve(here, '../manifest.prod.xml')

/** The origin Cornerstone is served from, and the path the pane is built to. */
export const PRODUCTION_ORIGIN = 'https://cornerstone.aubreylegal.com'
/** Where `npm run build:addin` puts the pane inside that origin. */
export const PANE_PATH = '/addin'

/**
 * A distinct identity from the development manifest, so the two can sit on one
 * machine at once. Office keys an installed add-in on this GUID: reusing the
 * development one would mean a developer's sideload and the deployed add-in
 * overwrite each other, and an attorney's Word could not hold both.
 */
export const PRODUCTION_ID = 'a9e939cf-5ba6-41c2-a136-03730c13eb05'

/** Office caches a manifest; a client keeps the old one until this increases. */
export const PRODUCTION_VERSION = '1.0.0.0'

const DEV_ORIGIN = 'https://localhost:3100'

export function buildProductionManifest(
  source,
  { origin = PRODUCTION_ORIGIN, id = PRODUCTION_ID, version = PRODUCTION_VERSION } = {},
) {
  let out = source

  // Order matters. The URL form carries a path and must be rewritten to sit
  // under the pane's directory; the bare form is the <AppDomain> entry, which
  // is an origin and must stay one.
  out = out.split(`${DEV_ORIGIN}/`).join(`${origin}${PANE_PATH}/`)
  out = out.split(DEV_ORIGIN).join(origin)

  out = out.replace(/<Id>[^<]+<\/Id>/, `<Id>${id}</Id>`)
  out = out.replace(/<Version>[^<]+<\/Version>/, `<Version>${version}</Version>`)

  const banner = `<!--
  GENERATED — do not edit.

  Produced from manifest.xml by scripts/manifest.mjs. Edit that file (or the
  script) and re-run \`npm run manifest\`; tests/word-addin-project.test.ts
  fails if this file and the generator disagree.

  This is the manifest uploaded to Microsoft 365 → Integrated apps. The
  development manifest beside it keeps its own <Id> so a sideload and this
  deployment can coexist on one machine.
-->
`
  // After the XML declaration, which must remain the first line.
  return out.replace(/(<\?xml[^>]*\?>\n)/, `$1${banner}`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
  }
  const out = resolve(arg('out', DEFAULT_OUT))
  const generated = buildProductionManifest(readFileSync(SOURCE, 'utf8'), {
    origin: arg('origin', PRODUCTION_ORIGIN),
  })

  if (process.argv.includes('--check')) {
    const existing = readFileSync(out, 'utf8')
    if (existing !== generated) {
      console.error(`${out} is out of date. Run: npm run manifest`)
      process.exit(1)
    }
    console.log(`${out} is up to date.`)
  } else {
    writeFileSync(out, generated)
    console.log(`Wrote ${out}`)
  }
}
