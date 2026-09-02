import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const here = path.resolve(__dirname, '..')
const repoRoot = path.resolve(here, '../..')

/**
 * Next resolves its convention files by walking UP from the app directory. Any
 * one of them that this app does not define is silently inherited from the root
 * app — its middleware, its instrumentation, its Sentry wiring.
 *
 * This has now bitten twice. `proxy.ts` was caught in review because the root
 * proxy imported a path that did not resolve here. `instrumentation.ts` was not:
 * npm hoists @sentry/nextjs into the shared node_modules, so the root file
 * compiled fine locally and in CI, and the build failed only on Vercel, which
 * installs scoped to this directory. It broke the first deploy of main.
 *
 * So the rule is enforced generally rather than one file at a time: for every
 * convention file the root app defines, this app must define its own.
 */
describe('workbench convention-file isolation', () => {
  // Next's root-level convention files. Not every one exists in either app;
  // the assertion is about the ones the root app actually has.
  const CONVENTION_FILES = [
    'proxy.ts',
    'middleware.ts',
    'instrumentation.ts',
    'instrumentation-client.ts',
  ]

  const rootDefines = CONVENTION_FILES.filter((f) => fs.existsSync(path.join(repoRoot, f)))

  it('knows which convention files the root app defines', () => {
    // If this fails the list above is stale, not the apps.
    expect(rootDefines.length).toBeGreaterThan(0)
  })

  it.each(rootDefines)('defines its own %s rather than inheriting the root app\'s', (file) => {
    const local = path.join(here, file)
    expect(
      fs.existsSync(local),
      `apps/workbench/${file} is missing, so Next will resolve ${file} from the repository root ` +
        `and this app will silently run the root app's version.`,
    ).toBe(true)
    expect(fs.readFileSync(local, 'utf8').trim().length).toBeGreaterThan(0)
  })

  it('does not import anything from the root app', () => {
    const files = fs
      .readdirSync(here, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath ?? here, entry.name))
      .filter((file) => !file.includes('node_modules') && !file.includes('.next'))

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/from '\.\.\/\.\.\/(?!\.)/)
    }
  })
})
