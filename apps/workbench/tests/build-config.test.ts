import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { workbenchConfig } from '../next.config'

const here = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])

/**
 * The build has to be honest about what it needs and what it tolerates.
 *
 * Vercel installs scoped to this directory, so a workspace package this app
 * transpiles but never declares resolves on a developer machine (npm hoists
 * it) and fails only in production. That is the class of failure that broke
 * the first deploy of main; the check here is the one the overhaul plan asked
 * for instead of another file-by-file test.
 */
describe('workbench build config', () => {
  it('declares every package it asks Next to transpile', () => {
    const transpiled = workbenchConfig.transpilePackages ?? []
    expect(transpiled.length).toBeGreaterThan(0)
    for (const name of transpiled) {
      expect(declared, `${name} is in transpilePackages but not in package.json`).toContain(name)
    }
  })

  it('transpiles the drafting engine, the package the product core lives in', () => {
    expect(workbenchConfig.transpilePackages).toContain('@aubrey-law/drafting-engine')
  })

  it('has no type-error escape hatch', () => {
    // A new app has no legacy debt to excuse. The root app's toggle exists
    // because it does; copying it here would let the workbench accumulate the
    // same debt from day one.
    expect(workbenchConfig.typescript?.ignoreBuildErrors).toBeUndefined()
  })
})
