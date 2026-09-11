import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Merging a migration used to change nothing until somebody remembered to run
 * `supabase db push`. Every incident catalogued in scripts/checkMigrationDrift.mjs
 * starts there, so the properties that make the deploy trustworthy are pinned
 * here rather than left to whoever next edits the workflow.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const WORKFLOW = read('.github/workflows/db-migrate-deploy.yml')

/** The body of one `- name: <label>` step, up to the next step at that indent. */
function step(label: string): string {
  const start = WORKFLOW.indexOf(`- name: ${label}`)
  expect(start, `no step named "${label}"`).toBeGreaterThan(-1)
  const next = WORKFLOW.indexOf('\n      - ', start + 1)
  return WORKFLOW.slice(start, next === -1 ? undefined : next)
}

describe('when the deploy runs', () => {
  it('fires on a migration merging to main, and can be triggered by hand', () => {
    // The manual trigger is the retry path: a failed deploy has to be
    // re-runnable without an empty commit.
    expect(WORKFLOW).toMatch(/on:\s*\n\s*push:\s*\n\s*branches: \[main\]\s*\n\s*paths:\s*\n\s*- 'supabase\/migrations\/\*\*'/)
    expect(WORKFLOW).toContain('workflow_dispatch:')
  })

  it('never runs twice at once and is never cancelled midway', () => {
    // `db push` applies migrations in sequence; killing it leaves the recorded
    // history describing less than the schema.
    expect(WORKFLOW).toMatch(/concurrency:\s*\n\s*group: db-migrate-deploy\s*\n\s*cancel-in-progress: false/)
  })

  it('names an environment, so an approval gate is a settings change', () => {
    expect(WORKFLOW).toMatch(/^\s+environment: production$/m)
  })
})

describe('what the deploy refuses to do quietly', () => {
  it('fails on a missing secret instead of warning and skipping', () => {
    // The sibling database workflows warn and skip, which is right for a check
    // and wrong here: a deploy that silently does nothing is the whole disease.
    const guard = step('Require credentials')
    expect(guard).toContain('::error::')
    expect(guard).toContain('exit 1')
    expect(guard).not.toContain('::warning::')
    expect(guard).not.toMatch(/^\s+if:/m)
    for (const secret of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_URL']) {
      expect(guard, secret).toContain(secret)
    }
  })

  it('shows what it is about to apply before applying it', () => {
    const dryRun = WORKFLOW.indexOf('- name: Show what will apply')
    const apply = WORKFLOW.indexOf('- name: Apply\n')
    expect(dryRun).toBeGreaterThan(-1)
    expect(apply).toBeGreaterThan(dryRun)
    expect(step('Show what will apply')).toContain('--dry-run')
    for (const label of ['Show what will apply', 'Apply']) {
      expect(step(label)).toContain('--project-ref "$PROJECT_REF"')
      expect(step(label)).toContain('--skip-vault')
    }
    expect(WORKFLOW).not.toContain('run: supabase link')
  })

  it('defaults manual verification to a dry run and never applies on a feature branch', () => {
    expect(WORKFLOW).toMatch(/dry_run:[\s\S]*?type: boolean\s+default: true/)
    const apply = step('Apply')
    expect(apply).toContain("github.ref == 'refs/heads/main'")
    expect(apply).toContain("github.event_name == 'push' || !inputs.dry_run")
    expect(apply).toContain('--yes')
  })

  it('re-checks the history afterwards, because a push can skip a version', () => {
    // 20260909000000 was used twice. `db push` applies a version once and
    // reports success, so the second file's SQL never ran while every status
    // stayed green. --strict fails on anything merged but unapplied.
    const apply = WORKFLOW.indexOf('- name: Apply\n')
    const verify = WORKFLOW.indexOf('check:migration-drift')
    expect(verify).toBeGreaterThan(apply)
    expect(step('Verify the repo and the history now agree')).toContain('--strict')
  })

  it('uses the CLI version the repo pins, not whatever is newest', () => {
    // supabase/migrations/README.md warns about version drift before a db push.
    expect(WORKFLOW).toContain('version: ${{ steps.cli.outputs.version }}')
    expect(WORKFLOW).not.toContain('version: latest')
    // The lockfile, not the caret range in package.json — the range's floor is
    // not what `npm ci` installs, so it would pin CI to an older CLI than the
    // one the migration was dry-run against.
    const resolve = step('Resolve the pinned CLI version')
    expect(resolve).toContain('package-lock.json')
    expect(resolve).toContain('devDependencies.supabase')
    expect(resolve.indexOf('package-lock.json')).toBeLessThan(resolve.indexOf('package.json\').devDependencies'))
  })

  it('says what to do when it goes red', () => {
    const onFailure = step('Explain a failure')
    expect(onFailure).toContain('if: failure()')
    expect(onFailure).toContain('migration list')
    expect(onFailure).toContain('supabase/migrations/README.md')
  })
})

describe('the drift check stays, and stops claiming nothing deploys', () => {
  it('still runs strict on a schedule as the backstop', () => {
    const drift = read('.github/workflows/db-migration-drift.yml')
    expect(drift).toContain("- cron: '0 12 * * 1-5'")
    expect(drift).toContain('npm run check:migration-drift -- --strict')
  })

  it('no longer tells the reader that migrations only move by hand', () => {
    // Two files carried that sentence as the reason they exist. Both had to
    // change with the behaviour, or the next reader is misled by a comment.
    for (const file of [
      '.github/workflows/db-migration-drift.yml',
      'scripts/checkMigrationDrift.mjs',
    ]) {
      const text = read(file)
      expect(text, file).not.toMatch(/Nothing deploys migrations/)
      expect(text, file).toContain('db-migrate-deploy')
    }
  })

  it('documents the deploy where the deployment workflow is written down', () => {
    const doc = read('supabase/migrations/README.md')
    expect(doc).toContain('db-migrate-deploy.yml')
    // The ordering caveat is the one that changes how migrations get written.
    expect(doc).toContain('safe against the')
    expect(doc).toContain('SUPABASE_DB_PASSWORD')
  })
})
