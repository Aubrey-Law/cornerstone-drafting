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
    // The root is a workspace root now, so the guard is no longer "there is no
    // workspaces key" — it is that the add-in never joins the hoisted tree.
    // Its Office.js/Vite toolchain must not shift resolution for the Next app.
    const workspaces: string[] = rootPkg.workspaces ?? []
    expect(workspaces).not.toContain('word-addin')
    expect(workspaces.some((glob) => glob === '*' || glob.startsWith('word-addin'))).toBe(false)
    // tools/* would sweep in docx-pdf-worker, a standalone Express service with
    // its own dependency tree; the two data-only packages are named instead.
    expect(workspaces).not.toContain('tools/*')
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

/**
 * Sideloading is hand-rolled because `office-addin-debugging` cannot do it on
 * macOS: it hard-links the manifest into Word's app container, and `link(2)`
 * fails there with EPERM. These pin the copy-based replacement.
 */
describe('word-addin sideload scripts', () => {
  const scripts = JSON.parse(read('word-addin/package.json')).scripts as Record<string, string>

  it('are what npm start and npm run stop invoke', () => {
    expect(scripts.start).toBe('node scripts/sideload.mjs')
    expect(scripts.stop).toBe('node scripts/unsideload.mjs')
    expect(fs.existsSync(path.join(root, 'word-addin/scripts/sideload.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'word-addin/scripts/unsideload.mjs'))).toBe(true)
  })

  it('copy the manifest rather than linking it', () => {
    const sideload = read('word-addin/scripts/sideload.mjs')
    expect(sideload).toContain('copyFileSync')

    // Comments stripped first: the script explains at length why it does NOT
    // link, and that prose is not a call site.
    const code = sideload.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // A hard link is the bug being fixed. A symlink is worse: the Office
    // tooling's uninstall path resolves entries with realpathSync before
    // deleting them, so a symlink here would delete the repo's own manifest.
    expect(code).not.toMatch(/linkSync\s*\(|symlink\s*\(/)
  })

  it('handle the permission denial instead of throwing a stack trace', () => {
    const sideload = read('word-addin/scripts/sideload.mjs')

    // macOS protects Word's container under ~/Library/Containers, so the copy
    // is refused even when reading the source and stat-ing the folder both
    // work. It is the likeliest way this script fails, and the fix is one
    // setting — a raw Node stack trace names neither.
    expect(sideload).toMatch(/catch\s*\(/)
    expect(sideload).toContain("'EPERM'")
    expect(sideload).toContain("'EACCES'")
    expect(sideload).toContain('Full Disk Access')
    // Anything that is not a permission problem must still surface as itself.
    expect(sideload).toContain('throw error')
  })

  it('verify the copy landed rather than trusting a silent success', () => {
    expect(read('word-addin/scripts/sideload.mjs')).toContain('statSync(destination)')
  })

  it('clear the cache Office actually uses, not just Word\'s', () => {
    const script = read('word-addin/scripts/clear-cache.mjs')
    // Add-in web content lives in Office's web host container, capital M and
    // all. Clearing only Word's own Caches directory looks like it worked and
    // changes nothing — which is exactly how this was got wrong once.
    expect(script).toContain('com.Microsoft.OsfWebHost')
    expect(JSON.parse(read('word-addin/package.json')).scripts['clear-cache']).toBe(
      'node scripts/clear-cache.mjs',
    )
  })

  it('no longer depend on office-addin-debugging', () => {
    const pkg = JSON.parse(read('word-addin/package.json'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(deps['office-addin-debugging']).toBeUndefined()
    // office-addin-dev-certs stays: it mints the HTTPS cert Office requires.
    expect(deps['office-addin-dev-certs']).toBeDefined()
  })

  it('derive the sideload filename from the manifest GUID', () => {
    const id = read('word-addin/manifest.xml').match(/<Id>\s*([0-9a-fA-F-]{36})\s*<\/Id>/)?.[1]
    expect(id).toBeTruthy()

    const helper = read('word-addin/scripts/manifestId.mjs')
    // Microsoft's own convention: their uninstall matches on startsWith(id),
    // so keeping it means their tooling and ours clean up after each other.
    expect(helper).toContain('${id}.manifest.xml')
    expect(helper).toContain('Library/Containers/com.microsoft.Word/Data/Documents/wef')
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
