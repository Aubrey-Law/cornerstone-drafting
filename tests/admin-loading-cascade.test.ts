import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Which skeleton each admin route actually gets.
 *
 * Next.js cascades `loading.tsx` down to every nested segment without one of
 * its own, which is easy to forget when writing a skeleton that draws a
 * particular page. The Today dashboard's skeleton sat at `app/admin/loading.tsx`
 * and so served twenty other routes — tables, settings panes and the matter
 * detail's full-height split pane all flashed a centred `max-w-4xl` column of
 * four cards and then reflowed into something else.
 *
 * These assert the cascade itself rather than the markup, because the cascade
 * is the thing that was wrong.
 */

const ROOT = join(__dirname, '..')
const ADMIN = join(ROOT, 'app/admin')

function walk(dir: string, found: { pages: string[]; loaders: string[] } = { pages: [], loaders: [] }) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, found)
    else if (entry === 'page.tsx') found.pages.push(dir)
    else if (entry === 'loading.tsx') found.loaders.push(dir)
  }
  return found
}

const { pages, loaders } = walk(ADMIN)
const loaderSet = new Set(loaders)

/** The loading.tsx a route actually renders: the nearest one at or above it. */
function skeletonFor(page: string): string | null {
  let dir = page
  while (dir.startsWith(ADMIN)) {
    if (loaderSet.has(dir)) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

const rel = (p: string) => p.slice(ROOT.length + 1)

describe('admin loading skeletons', () => {
  it('serves the dashboard skeleton to the dashboard alone', () => {
    // The whole defect in one assertion. Move this file back up to
    // app/admin/loading.tsx and the count goes to twenty-one.
    const today = join(ADMIN, '(today)')
    const served = pages.filter(page => skeletonFor(page) === today).map(rel)
    expect(served).toEqual(['app/admin/(today)'])
  })

  it('keeps the dashboard at /admin despite the route group', () => {
    // A route group's parentheses are not part of the URL, so the page still
    // answers /admin — but only if it is the only page.tsx at that level.
    expect(pages.map(rel)).toContain('app/admin/(today)')
    expect(pages.map(rel)).not.toContain('app/admin')
  })

  it('gives every admin route some skeleton', () => {
    const orphans = pages.filter(page => skeletonFor(page) === null).map(rel)
    expect(orphans).toEqual([])
  })

  it('has a fallback that does not commit to a layout', () => {
    // It stands in for routes of every shape, so it must not promise a width or
    // a card count. `max-w-4xl` is exactly what made the old one wrong.
    //
    // Comments are stripped first: the file's own docblock names the class it
    // must not use, and the first draft of this test went red on that. The
    // same trap caught the client-serif guard, which is a fair argument for
    // asserting against code rather than against a file.
    const fallback = readFileSync(join(ADMIN, 'loading.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(fallback).not.toMatch(/max-w-/)
    expect(fallback).not.toMatch(/Array\.from/)
  })

  it('still carries most of the admin app, so its shape matters', () => {
    // If this ever drops to zero the fallback is dead code and the assertion
    // above is guarding nothing.
    const served = pages.filter(page => skeletonFor(page) === ADMIN)
    expect(served.length).toBeGreaterThan(5)
  })
})
