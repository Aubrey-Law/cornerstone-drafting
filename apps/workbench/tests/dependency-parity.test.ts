import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const here = path.resolve(__dirname, '..')
const readPkg = (rel: string) =>
  JSON.parse(fs.readFileSync(path.resolve(here, rel), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

const workbench = readPkg('package.json')
const root = readPkg('../../package.json')

const allDeps = (pkg: ReturnType<typeof readPkg>) => ({
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
})

/**
 * Both apps install from one lockfile into one hoisted node_modules. If the
 * workbench asks for a different version of a package the root app already
 * depends on, npm resolves the conflict by nesting one of them — which changes
 * which copy the *root* app gets for anything it does not pin itself.
 *
 * That is a silent break in an application the firm uses daily, caused by a
 * change to an app it does not run. The rule holds until the old app is gone.
 */
describe('workbench dependency parity with the root app', () => {
  const shared = Object.keys(allDeps(workbench)).filter((name) => name in allDeps(root))

  it('shares real dependencies with the root app', () => {
    // A guard that silently matches nothing is worse than no guard.
    expect(shared.length).toBeGreaterThan(0)
    expect(shared).toContain('next')
    expect(shared).toContain('react')
  })

  it.each([...shared])('pins %s to the same range as the root app', (name) => {
    expect(allDeps(workbench)[name]).toBe(allDeps(root)[name])
  })

  it('never declares a cron path the root app already owns', () => {
    // Both apps deploy from the same repo against the same database, so a
    // cron path declared in *both* vercel.json files fires twice against the
    // same data — /api/cron/scheduled-emails in the root app runs every
    // minute and is not idempotent. That used to mean "the workbench
    // declares no crons at all," because it had none of its own. It has one
    // now: /api/cron/tick drives the workbench's own run queue
    // (workflow_runs / workflow_run_steps), tables the root app never
    // touches, so it is not a duplicate of anything the root app already
    // runs. The guard that actually matters — no path claimed by both — is
    // this one, not a blanket ban on the workbench ever having a cron.
    const workbenchVercel = JSON.parse(fs.readFileSync(path.resolve(here, 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string }>
    }
    const rootVercel = JSON.parse(fs.readFileSync(path.resolve(here, '../../vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string }>
    }
    const rootPaths = new Set((rootVercel.crons ?? []).map((cron) => cron.path))
    const workbenchPaths = (workbenchVercel.crons ?? []).map((cron) => cron.path)

    expect(workbenchPaths.length).toBeGreaterThan(0)
    for (const p of workbenchPaths) {
      expect(rootPaths.has(p)).toBe(false)
    }
  })
})
