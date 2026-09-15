import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `packages/db-types/src/supabase.generated.ts` is generated and checked in, and until this
 * workflow nothing compared it to the database. It drifted four merged
 * migrations out of date unnoticed — still declaring a dropped table and
 * columns, missing four newer objects — because almost all database code goes
 * through the permissive compatibility type and never reads it.
 *
 * The properties that make the check trustworthy are pinned here rather than
 * left to whoever next edits the workflow, the way tests/db-migrate-deploy.test.ts
 * pins the deploy's.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const WORKFLOW = read('.github/workflows/db-types-drift.yml')

/** One job's block, up to the next job at that indent. */
function job(name: string): string {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`)
  expect(start, `no job named "${name}"`).toBeGreaterThan(-1)
  const next = WORKFLOW.indexOf('\n  regenerate:\n', start + 1)
  return WORKFLOW.slice(start, name === 'types-drift' && next !== -1 ? next : undefined)
}

/** The body of one `- name: <label>` step, up to the next step at that indent. */
function step(label: string): string {
  const start = WORKFLOW.indexOf(`- name: ${label}`)
  expect(start, `no step named "${label}"`).toBeGreaterThan(-1)
  const next = WORKFLOW.indexOf('\n      - ', start + 1)
  return WORKFLOW.slice(start, next === -1 ? undefined : next)
}

describe('when the types check runs', () => {
  it('compares against the database on a schedule, not on every pull request', () => {
    // A branch that adds a migration is supposed to carry types the deployed
    // database does not have yet, so comparing there would fail every schema
    // PR for doing the right thing.
    expect(WORKFLOW).toContain("- cron: '0 12 * * 1-5'")
    expect(WORKFLOW).toContain('workflow_dispatch:')
    expect(job('types-drift')).toContain("github.event_name != 'pull_request'")
    expect(step('Regenerate types from the database')).toContain("steps.cli.outputs.version != ''")
  })

  it('runs the credential-free structural check everywhere, including pull requests', () => {
    const check = step('Check the checked-in types are generated, not a placeholder')
    expect(check).toContain('npm run check:db-types')
    expect(check).not.toContain('if:')
  })

  it('does not race the migration deploy on a push to main', () => {
    // db-migrate-deploy.yml applies migrations on that event; a types check
    // running alongside it would report drift a few seconds old.
    expect(WORKFLOW).not.toMatch(/push:\s*\n\s*branches: \[main\]/)
  })
})

describe('how it reaches the database', () => {
  const SCRIPT = read('scripts/generateSupabaseTypes.mjs')

  it('addresses the project by ref, not by linking to it', () => {
    // `supabase link` reads project settings and API keys, which needs
    // privileges that reading the schema does not. On 2026-09-15 it failed with
    // "your account does not have the necessary privileges" on a token that was
    // concurrently reading the migration history fine, and the whole check went
    // out — reporting a failure that looked like drift while comparing nothing.
    expect(SCRIPT).toContain('--project-id')
    expect(SCRIPT).not.toContain('--linked')
    // Comment lines are stripped: the workflow explains this absence in prose,
    // and matching that prose would make the assertion pass for the wrong reason.
    const commands = WORKFLOW.split('\n').filter(line => !/^\s*#/.test(line)).join('\n')
    expect(commands).not.toContain('supabase link')
  })

  it('refuses to run without the credentials it actually needs', () => {
    // A generator that produced nothing would leave the previous file in place
    // and read as "no drift" — the failure this whole workflow exists to catch.
    expect(SCRIPT).toContain('SUPABASE_ACCESS_TOKEN')
    expect(SCRIPT).toContain('process.exit(1)')
  })
})

describe('what the check does about drift', () => {
  it('fails, and prints the diff so the fix is obvious', () => {
    const compare = step('Fail on drift, printing it')
    expect(compare).toContain('git diff --quiet -- packages/db-types/src/supabase.generated.ts')
    expect(compare).toContain('git --no-pager diff -- packages/db-types/src/supabase.generated.ts')
    expect(compare).toContain('exit 1')
  })

  it('can raise the pull request itself, because regenerating needs credentials', () => {
    // Neither Docker (`--db-url`, `--local`) nor an access token (`--linked`)
    // is available in a development container, so "just regenerate it locally"
    // is not a fix anyone can carry out there.
    expect(job('regenerate')).toContain('inputs.open_pr')
    const pr = step('Open a pull request with the regenerated types')
    expect(pr).toContain('git push -u origin')
    expect(pr).toContain('gh pr create')
    // It commits only the generated file — never a stray change from the run.
    expect(pr).toContain('git add packages/db-types/src/supabase.generated.ts')
  })

  it('does not both open a pull request and fail the run for the same drift', () => {
    // The two jobs are mutually exclusive on the same condition.
    expect(job('types-drift')).toContain("if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.open_pr) }}")
    expect(job('regenerate')).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.open_pr }}")
  })

  it('asks for write access only in the job that writes', () => {
    // `permissions:` takes no expressions — a conditional one silently
    // invalidates the whole workflow file, which is why writing is its own job.
    expect(WORKFLOW).not.toMatch(/^\s*(contents|pull-requests):.*\$\{\{/m)
    expect(job('types-drift')).toMatch(/permissions:\s*\n\s*contents: read/)
    expect(job('regenerate')).toMatch(/permissions:\s*\n\s*contents: write\s*\n\s*pull-requests: write/)
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s*contents: read$/m)
  })

  it('keeps the pushed branch usable when the repo forbids Actions from opening pull requests', () => {
    // The push happens first, so the work survives; what has to survive with
    // it is a reason a reader can act on. A bare GraphQL error is not one.
    const pr = step('Open a pull request with the regenerated types')
    expect(pr).toContain('Allow GitHub Actions to create and approve pull requests')
    expect(pr).toContain('/compare/${GITHUB_REF_NAME}...${branch}?expand=1')
    // And it still fails: a run that could not open the PR has not finished.
    expect(pr).toContain('exit 1')
  })

  it('refuses to regenerate without credentials rather than reporting no drift', () => {
    // A regenerate run that quietly generated nothing would leave the file
    // unchanged, which reads exactly like "the types are fine".
    expect(step('Require credentials')).toContain('exit 1')
  })

  it('uses the CLI version the repo installed, like the deploy does', () => {
    // A newer CLI generates a different file, which would read as drift.
    expect(step('Resolve the pinned CLI version'))
      .toContain("require('./package-lock.json').packages['node_modules/supabase']")
  })

  it('warns rather than silently passing when the secrets are absent', () => {
    expect(step('Flag missing credentials')).toContain('::warning::')
  })
})
