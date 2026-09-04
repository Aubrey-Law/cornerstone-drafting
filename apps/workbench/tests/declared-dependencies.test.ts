import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'

const here = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])
const builtins = new Set(builtinModules)

/** `@scope/name/deep/path` → `@scope/name`; `name/deep` → `name`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? dir, entry.name))
    .filter((file) => !file.includes('node_modules') && !file.includes('/.next/'))
}

function bareImportsIn(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const specifiers: string[] = []
  const pattern = /(?:from|import)\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const spec = match[1]
    if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('node:')) continue
    // A regex literal like /from '\.\.\//... is not an import.
    if (/[\\()]/.test(spec)) continue
    specifiers.push(spec)
  }
  return specifiers
}

/**
 * Every bare import in this app must name a package this app declares.
 *
 * CI runs one hoisted `npm ci` at the repo root, so an import of something
 * only the root app declares resolves fine there and fails on Vercel, which
 * installs scoped to this directory. Nothing else catches that before deploy.
 * The rule covers production code and tests alike: a test that only passes
 * because of a hoisted package is a test that will not run on a clean install
 * of this app.
 */
describe('workbench declares every package it imports', () => {
  const files = sourceFiles(here).filter((f) => !f.endsWith('.d.ts'))

  it('scans real files', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  it.each(files.map((f) => [path.relative(here, f), f]))('%s', (_rel, file) => {
    for (const spec of bareImportsIn(file)) {
      const name = packageNameOf(spec)
      if (builtins.has(name)) continue
      expect(
        declared,
        `${path.relative(here, file)} imports "${spec}" but package.json does not declare "${name}"`,
      ).toContain(name)
    }
  })
})
