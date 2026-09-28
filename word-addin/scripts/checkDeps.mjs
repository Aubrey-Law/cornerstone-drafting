#!/usr/bin/env node
/**
 * Fail early, and say why, when the dependency tree is incomplete.
 *
 * `prebuild:next` installs this nested project during the root build, and the
 * root CI build runs under `NODE_ENV=production` (scripts/ciBuild.mjs), which
 * makes npm omit devDependencies. Everything this project builds with — vite,
 * typescript, @types/office-js — is a devDependency, so the install quietly
 * produced 3 packages instead of 135 and the only symptom was
 * `error TS2688: Cannot find type definition file for 'office-js'`, which reads
 * like a tsconfig fault rather than a missing install.
 *
 * `--include=dev` in `build:addin` is the fix. This check stays because the
 * distance between that cause and that symptom is the whole problem: anything
 * else that truncates the tree should fail here, naming itself.
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
      'A build under NODE_ENV=production omits devDependencies unless the install',
      'passes --include=dev, which is what every package here is. See',
      'word-addin/README.md, "How the pane is hosted".',
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
