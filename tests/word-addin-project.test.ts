import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * The add-in is a separate npm project nested in this repo. That only works
 * while the root build keeps ignoring it — and each of these exclusions was
 * needed for a different reason, so losing any one of them breaks a different
 * command.
 */
describe('word-addin build isolation', () => {
  it('is a private package the root does not depend on', () => {
    const addin = JSON.parse(read('word-addin/package.json'))
    expect(addin.private).toBe(true)

    const rootPkg = JSON.parse(read('package.json'))
    // A workspaces key would change hoisting for every root dependency.
    expect(rootPkg.workspaces).toBeUndefined()
    expect(JSON.stringify(rootPkg.dependencies ?? {})).not.toContain('word-addin')
    expect(JSON.stringify(rootPkg.devDependencies ?? {})).not.toContain('word-addin')
  })

  it('is excluded from BOTH tsconfigs', () => {
    // tsconfig.typecheck.json re-declares `exclude`, which replaces the base
    // array rather than merging with it — so `npm run typecheck` and
    // `next build` each need their own entry.
    expect(JSON.parse(read('tsconfig.json')).exclude).toContain('word-addin')
    expect(JSON.parse(read('tsconfig.typecheck.json')).exclude).toContain('word-addin')
  })

  it('is ignored by eslint', () => {
    expect(read('eslint.config.mjs')).toContain("'word-addin/**'")
  })

  it('is outside the root vitest scope', () => {
    // Add-in sources are read as text by these tests, never imported — they
    // reference Office.js globals that do not exist under vitest.
    expect(read('vitest.config.ts')).toMatch(/include:\s*\[\s*'tests\//)
  })
})

describe('word-addin manifest', () => {
  const manifest = new XMLParser({ ignoreAttributes: false }).parse(read('word-addin/manifest.xml'))
  const app = manifest.OfficeApp

  it('is a Word task pane with document write access', () => {
    expect(app['@_xsi:type']).toBe('TaskPaneApp')
    expect(app.Hosts.Host['@_Name']).toBe('Document')
    // search(), insertText(), changeTrackingMode, and getFileAsync all need it.
    expect(app.Permissions).toBe('ReadWriteDocument')
  })

  it('requires WordApi 1.6 — the version that first exposes tracked changes', () => {
    const sets = app.Requirements.Sets
    expect(sets['@_DefaultMinVersion']).toBe('1.6')
    expect(sets.Set['@_Name']).toBe('WordApi')
  })

  it('does not declare desktop-only or dialog requirement sets', () => {
    // Declaring WordApiDesktop (for pageSetup) or DialogApi would make the
    // add-in refuse to load in Word on the web entirely. Probe them at runtime.
    const raw = read('word-addin/manifest.xml')
    expect(raw).not.toContain('WordApiDesktop')
    expect(raw).not.toContain('DialogApi')
  })

  it('has its own GUID, not the one from the reference implementation', () => {
    expect(app.Id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(app.Id).not.toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('lists every origin it navigates to in AppDomains', () => {
    const raw = read('word-addin/manifest.xml')
    const domains = [app.AppDomains.AppDomain].flat()
    for (const url of raw.match(/https:\/\/localhost:\d+/g) ?? []) {
      expect(domains).toContain(url)
    }
  })
})
