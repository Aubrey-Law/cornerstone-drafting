#!/usr/bin/env node
/**
 * Fail early, and say why, when the dependency tree is incomplete.
 *
 * `prebuild:next` installs this nested project during the root build. That
 * install landed incomplete once in GitHub Actions — 3 packages where a clean
 * checkout gets 135 — and the only symptom was
 * `error TS2688: Cannot find type definition file for 'office-js'`, which reads
 * like a tsconfig fault rather than a missing install. It could not be
 * reproduced on macOS with npm 10 or 11, from a clean clone, or after a root
 * `npm ci`, so this runs between the install and the build to name the real
 * problem wherever it next happens.
 *
 * Only the packages whose absence produces a misleading error are checked —
 * anything else fails as itself.
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const require = createRequire(import.meta.url)

/** `types` in tsconfig.json — tsc reports these as a tsconfig error, not a missing module. */
const TYPE_PACKAGES = ['@types/node', '@types/office-js']

const missing = TYPE_PACKAGES.filter(
  (pkg) => !existsSync(resolve(projectRoot, 'node_modules', pkg)),
)

if (missing.length > 0) {
  const modules = resolve(projectRoot, 'node_modules')
  const installed = existsSync(modules) ? readdirSync(modules).length : 0
  console.error(
    [
      '',
      `The Word add-in's dependencies are incomplete: ${missing.join(', ')} not installed.`,
      '',
      `  node_modules entries: ${installed} (a complete install has roughly 93)`,
      `  looked in:            ${modules}`,
      '',
      'This is an install problem, not a tsconfig one. Re-run:',
      '',
      '    npm run build:addin',
      '',
      'If it persists in CI, the nested install is resolving against the parent',
      'tree — see word-addin/README.md, "How the pane is hosted".',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

// Resolvable as well as present: a directory with no usable entry point is the
// same failure one step later.
for (const pkg of ['vite', 'typescript']) {
  try {
    require.resolve(`${pkg}/package.json`, { paths: [projectRoot] })
  } catch {
    console.error(`The Word add-in's dependencies are incomplete: ${pkg} is not resolvable.`)
    process.exit(1)
  }
}
