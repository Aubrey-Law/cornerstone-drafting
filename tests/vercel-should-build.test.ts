import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'

const script = path.join(process.cwd(), 'scripts/vercel-should-build.sh')

function run(env: Record<string, string>): number {
  try {
    execSync(`bash ${script}`, {
      // The script falls back to `git rev-parse --abbrev-ref HEAD` when
      // VERCEL_GIT_COMMIT_REF is unset, so without an explicit ref this test
      // reports whatever branch the checkout happens to be on — it failed for
      // everyone working on `main`. Default the ref so each case is hermetic;
      // individual tests still override it.
      env: { ...process.env, VERCEL_GIT_COMMIT_REF: 'test-branch', ...env },
      stdio: 'pipe',
    })
    return 0
  } catch (error) {
    const err = error as { status?: number }
    return err.status ?? 1
  }
}

describe('vercel-should-build.sh', () => {
  it('builds production and skips preview deployments', () => {
    expect(run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_MESSAGE: 'ship' })).toBe(1)
    expect(run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_MESSAGE: 'wip' })).toBe(0)
  })

  it('builds when branch is main even without VERCEL_ENV', () => {
    expect(run({ VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_MESSAGE: 'ship' })).toBe(1)
  })

  it('honors [skip deploy] in commit messages', () => {
    expect(
      run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_MESSAGE: 'docs [skip deploy]' }),
    ).toBe(0)
  })
})
