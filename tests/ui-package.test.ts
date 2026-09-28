import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const pkgDir = path.join(root, 'packages/ui')
const srcDir = path.join(pkgDir, 'src')
const shimDir = path.join(root, 'components/ui')

const read = (p: string) => fs.readFileSync(p, 'utf8')
const listTsx = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).sort() : []

/**
 * The shadcn primitives, the theme CSS and `cn` are one design system shared by
 * both apps. They live in `@aubrey-law/ui`; `components/ui/*` in the root app
 * are one-line re-exports so its 231 import sites keep working until it is
 * retired. The package must not reach back into the root app, or the workbench
 * inherits a dependency on code scheduled for deletion.
 */
describe('@aubrey-law/ui package', () => {
  const primitives = listTsx(srcDir)

  it('holds every primitive the root app exposes under components/ui', () => {
    expect(primitives.length).toBeGreaterThan(20)
    expect(listTsx(shimDir)).toEqual(primitives)
  })

  it.each(primitives)('%s imports nothing from the root app', (file) => {
    const source = read(path.join(srcDir, file))
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toMatch(/from ['"]\.\.\/\.\./)
  })

  it.each(listTsx(shimDir))('components/ui/%s re-exports from the package', (file) => {
    const name = file.replace(/\.tsx$/, '')
    const source = read(path.join(shimDir, file))
    expect(source).toMatch(new RegExp(`from '@aubrey-law/ui/${name}'`))
    // A shim carries no styling of its own; the class strings live in the package.
    expect(source).not.toMatch(/className=\{cn\(/)
  })

  it('declares every bare import at the exact range the root app uses', () => {
    const pkg = JSON.parse(read(path.join(pkgDir, 'package.json'))) as {
      name: string
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const rootPkg = JSON.parse(read(path.join(root, 'package.json'))) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const rootDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies }
    const declared = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }

    expect(pkg.name).toBe('@aubrey-law/ui')
    const imported = new Set<string>()
    for (const file of fs.readdirSync(srcDir, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(file)) continue
      const source = read(path.join(srcDir, file))
      for (const m of source.matchAll(/from ['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        imported.add(name)
      }
    }
    expect(imported.size).toBeGreaterThan(5)
    for (const name of imported) {
      expect(declared, `${name} is imported by packages/ui but not declared there`).toHaveProperty(name)
      expect(declared[name], `${name}: packages/ui pins a different range than the root app`).toBe(rootDeps[name])
    }
  })

  it('owns the theme CSS and its generator', () => {
    expect(fs.existsSync(path.join(pkgDir, 'styles/theme/index.css'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'styles/theme'))).toBe(false)
    expect(read(path.join(root, 'app/globals.css'))).toMatch(/@import '@aubrey-law\/ui\/styles\/theme\/index\.css'/)
    // The generator writes into the package, so `npm run theme:generate` cannot
    // resurrect a root copy.
    const generator = read(path.join(pkgDir, 'scripts/generate-theme-css.ts'))
    expect(generator).toMatch(/styles\/theme/)
    expect(generator).not.toMatch(/from ['"]@\//)
    const scripts = (JSON.parse(read(path.join(root, 'package.json'))) as { scripts: Record<string, string> }).scripts
    expect(scripts['theme:generate']).toMatch(/packages\/ui\/scripts\/generate-theme-css\.ts/)
  })

  it('is a dependency of the app', () => {
    const rootPkg = JSON.parse(read(path.join(root, 'package.json'))) as { dependencies: Record<string, string> }
    expect(rootPkg.dependencies['@aubrey-law/ui']).toBe('*')
  })
})
