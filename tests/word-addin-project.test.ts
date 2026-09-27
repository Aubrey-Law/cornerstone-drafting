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

  it('does not inherit the root PostCSS config', () => {
    // The other exclusions keep the root build off the add-in. This one runs
    // the other way: Vite searches *upward* for a PostCSS config, so from
    // word-addin/ it finds the repo root's postcss.config.mjs and tries to
    // require @tailwindcss/postcss — a Next app dependency the nested project
    // does not install. That broke `vite build` outright.
    //
    // Tailwind gets in through @tailwindcss/vite instead, so an inline empty
    // config is correct as well as sufficient: it is what stops the search.
    const viteConfig = read('word-addin/vite.config.ts')
    expect(viteConfig).toMatch(/css:\s*\{\s*postcss:\s*\{\s*\}\s*\}/)
    expect(viteConfig).toContain('@tailwindcss/vite')

    const addinDeps = JSON.parse(read('word-addin/package.json')).devDependencies
    expect(addinDeps['@tailwindcss/postcss']).toBeUndefined()
    expect(fs.existsSync(path.join(root, 'word-addin/postcss.config.mjs'))).toBe(false)
  })

  it('type-checks its own Node-land config files', () => {
    // tsconfig `include` covers vite.config.ts and vitest.config.ts, which use
    // process, node:path and import.meta.dirname. Without the node types those
    // are 10 errors, and since `build` is `typecheck && vite build`, the whole
    // build fails — which nothing in CI would have caught.
    const tsconfig = JSON.parse(read('word-addin/tsconfig.json'))
    expect(tsconfig.compilerOptions.types).toContain('node')
    expect(JSON.parse(read('word-addin/package.json')).devDependencies['@types/node']).toBeDefined()
  })
})

/**
 * The pane is served by the Next app out of `public/addin/`, which is the only
 * thing that makes the add-in's API calls same-origin in production. That is a
 * build-artifact path, deliberately not a source-tree merge: every exclusion
 * above still holds.
 */
describe('word-addin production hosting', () => {
  const rootPkg = JSON.parse(read('package.json'))
  const scripts = rootPkg.scripts as Record<string, string>
  const viteConfig = read('word-addin/vite.config.ts')

  it('builds through a prefix install, never a workspace one', () => {
    // The root `npm ci` does not install this project — it is not a workspace,
    // and pinning that above is worth nothing if the build quietly relies on
    // hoisted dependencies instead.
    expect(scripts['build:addin']).toContain('--prefix word-addin')
    expect(scripts['build:addin']).toContain('npm --prefix word-addin ci')
  })

  it('runs that build before every Next build', () => {
    // Vercel's build command is `build:next`, so `prebuild:next` is what makes
    // the pane exist in the deployment at all.
    expect(scripts['prebuild:next']).toContain('build:addin')
  })

  it('emits into the Next app public directory', () => {
    expect(viteConfig).toContain("'../public/addin'")
    // Vite refuses to clear an outDir outside its own root without this.
    expect(viteConfig).toMatch(/emptyOutDir:\s*true/)
  })

  it('prefixes built asset URLs but leaves the dev server at the root', () => {
    // `manifest.xml` sideloads against https://localhost:3100/taskpane.html, so
    // a `/addin/` base in development would 404 the pane.
    expect(viteConfig).toMatch(/base:\s*command === 'build' \? '\/addin\/' : '\/'/)
  })

  it('keeps hashed bundles out of the unhashed icon directory', () => {
    // Vite copies `public/assets/` verbatim — the ribbon icons are not
    // content-hashed. They share a cache rule with whatever sits beside them,
    // and `immutable` is right for a hashed bundle and wrong for an icon.
    expect(viteConfig).toMatch(/assetsDir:\s*'static'/)

    const nextConfig = read('next.config.mjs')
    expect(nextConfig).toContain("source: '/addin/static/:path*'")
    expect(nextConfig).toContain('immutable')
    expect(nextConfig).not.toContain("source: '/addin/assets/:path*'")
  })

  it('never caches the three HTML entry points', () => {
    // Word's WebView holds on to add-in content hard enough that a cached
    // bundle reads as a bug. These three are the whole set.
    const nextConfig = read('next.config.mjs')
    expect(nextConfig).toMatch(/\['taskpane', 'dialog', 'commands'\]/)
    expect(nextConfig).toContain('no-store, no-cache, must-revalidate')
  })

  it('refuses to deploy a pane that cannot sign in', () => {
    // Vite inlines the Supabase values at build time. With neither a root .env
    // nor the variables in the environment the build still succeeds and emits
    // `createClient(undefined, undefined)`: a pane that loads, renders, and
    // fails only when an attorney tries to sign in. Observed for real — a fresh
    // worktree has no .env, and the build said nothing.
    //
    // Scoped to a production Vercel build because CI and fresh worktrees both
    // build with no environment at all, and failing those would be noise.
    expect(viteConfig).toContain('assertSignInIsPossible')
    expect(viteConfig).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(viteConfig).toMatch(/process\.env\.VERCEL_ENV === 'production'/)
    expect(viteConfig).toContain('throw new Error(')
  })

  it('is build output, not source', () => {
    expect(read('.gitignore')).toContain('public/addin/')
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


/**
 * The production manifest is generated, and the copy in the tree is what an
 * administrator uploads to Microsoft 365. Both facts have to stay true at once.
 */
describe('word-addin production manifest', () => {
  const prod = read('word-addin/manifest.prod.xml')
  const dev = read('word-addin/manifest.xml')

  it('matches what the generator produces', async () => {
    const { buildProductionManifest } = await import('../word-addin/scripts/manifest.mjs')
    expect(prod).toBe(buildProductionManifest(dev))
  })

  it('carries its own identity, so a sideload and a deployment can coexist', () => {
    const id = (xml: string) => xml.match(/<Id>\s*([0-9a-fA-F-]{36})\s*<\/Id>/)?.[1]
    expect(id(prod)).toBeTruthy()
    expect(id(prod)).not.toBe(id(dev))
  })

  it('points at the deployed origin, never at a developer machine', () => {
    // The whole failure this guards: the development manifest was once uploaded
    // to Integrated apps as-is, which installs an add-in whose pane is served
    // from a localhost port that nothing on an attorney's machine is listening on.
    expect(prod).not.toMatch(/localhost:\d+/)
    expect(prod).toContain('https://cornerstone.aubreylegal.com/addin/taskpane.html')
  })

  it('serves the pane from the path the build writes', () => {
    // `base: '/addin/'` and `outDir: ../public/addin` on one side, these URLs on
    // the other. They are the same decision and have to move together.
    for (const file of ['taskpane.html', 'commands.html', 'assets/icon-32.png']) {
      expect(prod).toContain(`https://cornerstone.aubreylegal.com/addin/${file}`)
    }
  })
})

describe.each([
  ['development', 'word-addin/manifest.xml'],
  ['production', 'word-addin/manifest.prod.xml'],
])('word-addin %s manifest', (_kind, manifestPath) => {
  const manifest = new XMLParser({ ignoreAttributes: false }).parse(read(manifestPath))
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
    const raw = read(manifestPath)
    expect(raw).not.toContain('WordApiDesktop')
    expect(raw).not.toContain('DialogApi')
  })

  it('has its own GUID, not the one from the reference implementation', () => {
    expect(app.Id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(app.Id).not.toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('lists every origin it navigates to in AppDomains', () => {
    // Generalised from a localhost-only match: an Office dialog may navigate
    // only to a listed domain, and the production manifest is not on localhost,
    // so the old pattern passed it vacuously.
    const raw = read(manifestPath)
    const domains = [app.AppDomains.AppDomain].flat()
    const origins = new Set(
      (raw.match(/https:\/\/[a-z0-9.:-]+/gi) ?? [])
        .filter((url) => !url.includes('schemas.microsoft.com'))
        .filter((url) => !url.includes('appsforoffice'))
        .map((url) => new URL(url).origin),
    )
    for (const origin of origins) expect(domains).toContain(origin)
  })
})
