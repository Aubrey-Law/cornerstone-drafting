import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const readJson = (rel: string) => JSON.parse(read(rel))

/**
 * This repository owns @aubrey-law/estate-fields (owner decision 2026-09-02,
 * scope-reduction task 8.5.3). Before that, four committed documents said the
 * sibling `aubrey-law-app` repo was the source of truth while the plan said the
 * opposite — a contradiction that sat in the tree long enough to block work.
 *
 * These assertions are cheap and pin the parts that can regress silently. The
 * part that cannot be pinned from here is the other repository, which still
 * holds its own copy; see packages/estate-fields/SYNC.md.
 */
describe('estate-fields ownership', () => {
  it('is depended on as a workspace member, not a path into another repo', () => {
    const rootPkg = readJson('package.json')
    const spec: string = rootPkg.dependencies['@aubrey-law/estate-fields']
    expect(spec).toBeDefined()

    // The retired arrangement was `file:../aubrey-law-app/packages/estate-fields`.
    // Any spec climbing out of this repo needs both checkouts side by side on
    // one disk — true on a laptop, false in CI and on Vercel.
    expect(spec).not.toMatch(/\.\./)
    expect(rootPkg.workspaces).toContain('packages/*')
  })

  it('declares a version, which is the only signal a consumer gets', () => {
    const pkg = readJson('packages/estate-fields/package.json')
    expect(pkg.name).toBe('@aubrey-law/estate-fields')
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('documents this repository as the source of truth', () => {
    // Asserted positively: flipping ownership back means consciously editing
    // this test, rather than a doc quietly drifting out of step again.
    const sync = read('packages/estate-fields/SYNC.md')
    const sourceOfTruth = sync.split('## Workflow')[0] ?? ''
    expect(sourceOfTruth).toMatch(/This repository \*\*owns\*\* the package|\*\*This repository owns the package\.\*\*/)
    expect(sourceOfTruth).not.toMatch(/The package lives at `aubrey-law-app/)
  })

  it('does not prescribe the retired cross-repo path anywhere', () => {
    const docs = [
      'packages/estate-fields/SYNC.md',
      'packages/estate-fields/README.md',
      'VERCEL_ENV_CHECKLIST.md',
      'docs/design-sheet-sections/client-information.md',
    ]
    for (const doc of docs) {
      const text = read(doc)
      const mentions = text.split('\n').filter((line) => line.includes('file:../aubrey-law-app'))
      // SYNC.md and the README may still name the path to say it is retired.
      for (const line of mentions) {
        expect(line).toMatch(/[Rr]etired|do not|Do not|never|fails/)
      }
    }
  })
})
