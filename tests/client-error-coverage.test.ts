import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every client-facing route is caught before it reaches global-error.
 *
 * Deliberately in its own file, importing none of the boundaries it checks for.
 * The first version of this lived beside the render tests, which import
 * `app/sign/error` directly — so deleting that boundary to prove the guard
 * worked only made the whole file fail to resolve its imports, and the coverage
 * assertion never ran at all. A guard that cannot survive the condition it
 * detects does not detect it.
 *
 * The state this exists to prevent: `sign`, `intake` and `book` had no
 * error.tsx at all, so a render failure fell through to app/global-error.tsx —
 * which replaces the whole document, introduced itself to clients as
 * "Cornerstone Drafting", and offered nothing but the button that had just
 * broken.
 */

const ROOT = join(__dirname, '..')
const APP = join(ROOT, 'app')

function walk(dir: string, found: { pages: string[]; boundaries: string[] } = { pages: [], boundaries: [] }) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'api') walk(full, found)
    } else if (entry === 'page.tsx') found.pages.push(dir)
    else if (entry === 'error.tsx') found.boundaries.push(dir)
  }
  return found
}

const { pages, boundaries } = walk(APP)
const boundarySet = new Set(boundaries)

/** The error.tsx that actually catches for a route: the nearest at or above it. */
function boundaryFor(page: string): string | null {
  let dir = page
  while (dir.startsWith(APP)) {
    if (boundarySet.has(dir)) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

const rel = (p: string) => p.slice(ROOT.length + 1)
const CLIENT_TREES = ['app/sign', 'app/intake', 'app/book', 'app/(portal)']
const inTree = (page: string, tree: string) => rel(page) === tree || rel(page).startsWith(`${tree}/`)

describe('client-facing error boundary coverage', () => {
  it('leaves no client-facing route uncovered', () => {
    const uncovered = pages
      .filter(page => CLIENT_TREES.some(tree => inTree(page, tree)))
      .filter(page => boundaryFor(page) === null)
      .map(rel)

    expect(uncovered, 'a client-facing route with no error.tsx above it').toEqual([])
  })

  it('covers each client tree individually', () => {
    // Named one by one so a failure says which surface lost its net, rather
    // than only that some route somewhere did.
    for (const tree of CLIENT_TREES) {
      const routes = pages.filter(page => inTree(page, tree))
      expect(routes.length, `${tree} should have routes`).toBeGreaterThan(0)
      expect(
        routes.filter(page => boundaryFor(page) === null).map(rel),
        `${tree} should have its own boundary`,
      ).toEqual([])
    }
  })

  it('never shows a client the internal product name', () => {
    // The specific wrongness this replaces: "We could not load Cornerstone".
    // Comments are stripped first — these files discuss the old copy by name,
    // and matching raw text would go red on the explanation, not the markup.
    for (const file of [
      'app/sign/error.tsx',
      'app/intake/error.tsx',
      'app/book/error.tsx',
      'app/global-error.tsx',
      'components/ClientErrorState.tsx',
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      expect(source, `${file} should not name the product to a client`).not.toMatch(/Cornerstone/)
    }
  })
})
