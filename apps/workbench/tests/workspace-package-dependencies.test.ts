import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'

const here = path.resolve(__dirname, '..')
const repoRoot = path.resolve(here, '../..')
const builtins = new Set(builtinModules)

type Manifest = {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readManifest = (dir: string): Manifest =>
  JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest

/** Where the workspace globs put a package, by its declared name. */
function workspacePackageDirs(): Map<string, string> {
  const root = readManifest(repoRoot) as Manifest & { workspaces?: string[] }
  const dirs = new Map<string, string>()
  for (const pattern of root.workspaces ?? []) {
    const [base, star] = pattern.split('/*')
    const candidates = star === undefined
      ? [path.join(repoRoot, pattern)]
      : fs
          .readdirSync(path.join(repoRoot, base), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(repoRoot, base, entry.name))
    for (const dir of candidates) {
      if (!fs.existsSync(path.join(dir, 'package.json'))) continue
      const name = readManifest(dir).name
      if (name) dirs.set(name, dir)
    }
  }
  return dirs
}

const packageNameOf = (specifier: string): string => {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Comments are stripped before scanning, and that is not fussiness.
 * This codebase explains itself at length, and a sentence like
 * `... nothing" from "the model proposed something ...` reads as a static
 * import of a package called "the model proposed something" — a failure that
 * points at the wrong file and wastes the reader's time on a real one.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // The `[^:]` guard leaves `https://` inside a string literal alone.
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function bareImports(dir: string): Set<string> {
  const names = new Set<string>()
  const src = path.join(dir, 'src')
  const scanRoot = fs.existsSync(src) ? src : dir
  const files = fs
    .readdirSync(scanRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => path.join(entry.parentPath ?? scanRoot, entry.name))
    .filter((file) => !file.includes('node_modules'))

  for (const file of files) {
    const source = withoutComments(fs.readFileSync(file, 'utf8'))
    // Three shapes, kept apart on purpose. `from '...'` with no parenthesis is
    // a static import — matching `from(` too would read Supabase's
    // `.from('document_text_layers')` as a package name. The require forms
    // catch runtime resolution, which is how the PDF extractor reaches its
    // native canvas binding.
    const patterns = [
      /\bfrom\s*['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
      /\w*[Rr]equire\w*(?:\.resolve)?\s*\(\s*['"]([^'"]+)['"]/g,
    ]
    for (const match of patterns.flatMap((pattern) => [...source.matchAll(pattern)])) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('node:')) continue
      if (/[\\()]/.test(specifier)) continue
      const name = packageNameOf(specifier)
      if (!builtins.has(name)) names.add(name)
    }
  }
  return names
}

/**
 * Every workspace package this app depends on must declare what it imports.
 *
 * This is the check that was missing, and it cost a production deploy. CI runs
 * one hoisted `npm ci` at the repository root, so a package that imports
 * `jszip` without declaring it resolves fine here — the root app declares it,
 * and npm puts one copy at the top. Vercel installs scoped to this app's
 * directory, where nothing supplies it, so the build fails there and only
 * there.
 *
 * `declared-dependencies.test.ts` already holds this app's own files to the
 * rule. This extends it to the packages the app pulls in, which is where the
 * failure actually happened: @aubrey-law/drafting-engine imported four runtime
 * packages and declared none of them, invisible for as long as only the old
 * app imported it.
 */
describe('workspace packages declare what they import', () => {
  const dirs = workspacePackageDirs()

  /** Every workspace package reachable from this app, transitively. */
  const reachable = (() => {
    const found = new Map<string, string>()
    const queue = Object.keys({
      ...(readManifest(here).dependencies ?? {}),
      ...(readManifest(here).devDependencies ?? {}),
    })
    while (queue.length > 0) {
      const name = queue.shift()!
      const dir = dirs.get(name)
      if (!dir || found.has(name)) continue
      found.set(name, dir)
      const manifest = readManifest(dir)
      queue.push(...Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}) }))
    }
    return found
  })()

  it('reaches the packages this app is built on', () => {
    // A guard that silently matches nothing is worse than no guard.
    expect([...reachable.keys()].sort()).toEqual(
      expect.arrayContaining([
        '@aubrey-law/citations',
        '@aubrey-law/drafting-engine',
        '@aubrey-law/ui',
      ]),
    )
  })

  it.each([...reachable.entries()].map(([name, dir]) => [name, dir]))(
    '%s declares every package it imports',
    (name, dir) => {
      const manifest = readManifest(dir)
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ])
      for (const imported of bareImports(dir)) {
        expect(
          declared,
          `${name} imports "${imported}" but its package.json does not declare it. ` +
            `It resolves in CI only because another package hoists it; a scoped install on Vercel has no copy.`,
        ).toContain(imported)
      }
    },
  )

  it.each([...reachable.entries()].map(([name, dir]) => [name, dir]))(
    'this app supplies %s its peer dependencies',
    (name, dir) => {
      const peers = Object.keys(readManifest(dir).peerDependencies ?? {})
      if (peers.length === 0) return
      const appDeps = new Set([
        ...Object.keys(readManifest(here).dependencies ?? {}),
        ...Object.keys(readManifest(here).devDependencies ?? {}),
      ])
      for (const peer of peers) {
        // A peer is the consumer's to provide; unprovided, it is absent at runtime.
        expect(appDeps, `${name} needs peer "${peer}", which this app does not declare`).toContain(peer)
      }
    },
  )
})
