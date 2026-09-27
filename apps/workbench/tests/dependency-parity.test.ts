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

  it('declares no crons: the run queue moved to the root app', () => {
    // Both apps deploy from the same repo against the same database, so a
    // cron declared in both fires twice against the same data. The workbench
    // had one — /api/cron/tick, which worked the run queue — until the queue
    // moved to the root app as /api/cron/run-queue. Two workers claiming runs
    // is safe (`claim_workflow_run` hands a run to one of them), but the
    // fiduciary and name sweeps each tick carries are not built to race
    // another copy of themselves, so the queue has exactly one home.
    const workbenchVercel = JSON.parse(fs.readFileSync(path.resolve(here, 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string }>
    }
    const rootVercel = JSON.parse(fs.readFileSync(path.resolve(here, '../../vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string }>
    }
    expect(workbenchVercel.crons ?? []).toEqual([])
    expect((rootVercel.crons ?? []).map((cron) => cron.path)).toContain('/api/cron/run-queue')
  })
})
