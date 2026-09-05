import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * The gate on pull requests that a workflow opens.
 *
 * GitHub starts no workflow run for a pull request opened with the repository's
 * own GITHUB_TOKEN — a rule that stops a workflow triggering itself, and one
 * that quietly removed the merge gate here. `db-types-drift.yml` raises a pull
 * request whenever the generated types fall behind the database, and #408
 * arrived with none of the four required checks: not failing, not pending,
 * absent. On `main`, `enforce_admins` is off, so the person who can merge it is
 * also the person entitled to bypass, and what they see is a pull request with
 * nothing red on it.
 *
 * Two things close that, and both are pinned here rather than left to whoever
 * next edits a workflow. The pull request is opened as a draft, which nobody
 * can merge; and every workflow behind a required check listens for
 * `ready_for_review`, so a person marking it ready — an event from a person,
 * not from the token — runs the gate.
 */

const repoRoot = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

/**
 * Each required status check, and the workflow whose job reports it.
 *
 * The names are the exact strings in `main`'s branch protection. Renaming a job
 * without updating protection leaves a check that can never report, which is
 * the same silent hole from a different direction, so this fails instead.
 */
const REQUIRED_CHECKS: Record<string, string> = {
  'Lint, typecheck, and tests': 'app-ci.yml',
  'Generated types match the database': 'db-types-drift.yml',
  'RPCs called in code exist in the database': 'db-rpc-check.yml',
  'Repo migrations match the database history': 'db-migration-drift.yml',
}

interface Workflow {
  on?: { pull_request?: { types?: string[] } | null }
  jobs?: Record<string, { name?: string }>
}

const load = (file: string): Workflow =>
  yaml.load(read(`.github/workflows/${file}`)) as Workflow

describe('a pull request a workflow opened still meets the gate', () => {
  it.each(Object.entries(REQUIRED_CHECKS))(
    '"%s" is a job that exists, in %s',
    (check, file) => {
      const names = Object.values(load(file).jobs ?? {}).map((job) => job.name)
      expect(names).toContain(check)
    },
  )

  it.each([...new Set(Object.values(REQUIRED_CHECKS))])(
    '%s runs when a draft is marked ready for review',
    (file) => {
      // The only human action on such a pull request that starts a workflow.
      // Without it, marking ready leaves the checks as absent as they began.
      expect(load(file).on?.pull_request?.types).toContain('ready_for_review')
    },
  )

  it.each([...new Set(Object.values(REQUIRED_CHECKS))])(
    '%s still runs on the ordinary pull request events too',
    (file) => {
      // Naming any type replaces the defaults, so the three that were implicit
      // have to be written out. Losing `synchronize` would stop the checks on
      // every push to a branch, which is most of what they are for.
      const types = load(file).on?.pull_request?.types
      expect(types).toEqual(expect.arrayContaining(['opened', 'synchronize', 'reopened']))
    },
  )
})

describe('when the types workflow opens its pull request', () => {
  const workflow = read('.github/workflows/db-types-drift.yml')
  const create = workflow.slice(workflow.indexOf('gh pr create'))

  it('opens it as a draft, which no one can merge', () => {
    expect(create).toMatch(/^gh pr create[^\n]*\n\s*--draft\b/)
  })

  it('reads the body from a file that is really there', () => {
    const match = create.match(/--body-file (\S+)/)
    expect(match, 'the pull request body should come from --body-file').not.toBeNull()
    const body = read(match![1])
    // The body carries the one instruction that starts the checks. A body that
    // did not say so would leave a draft nobody knows how to advance.
    expect(body).toContain('Ready for review')
    expect(body.length).toBeGreaterThan(200)
  })

  it('does not claim the types have been verified', () => {
    const body = read('.github/pr-bodies/regenerated-types.md')
    expect(body).toMatch(/[Nn]othing has tested this yet/)
  })
})
