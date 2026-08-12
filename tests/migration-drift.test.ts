import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareMigrations,
  duplicateVersions,
  localMigrations,
  localVersions,
  nameMismatches,
  recoveredMigrationFile,
} from '@/scripts/checkMigrationDrift.mjs'

describe('compareMigrations', () => {
  it('reports nothing when the repo and the history agree', () => {
    const v = ['20260101000000', '20260102000000']
    expect(compareMigrations(v, v)).toEqual({ pending: [], orphaned: [], outOfOrder: [] })
  })

  it('flags a migration that was merged but never applied', () => {
    // The opt-in outage: 20260904000000 sat in the repo for weeks while every
    // lead opt-in save failed against a database that never got the index.
    expect(
      compareMigrations(['20260101000000', '20260904000000'], ['20260101000000']),
    ).toMatchObject({ pending: ['20260904000000'], orphaned: [] })
  })

  it('flags a history row with no migration file behind it', () => {
    // A wall-clock version stamped by applying DDL out of band. Left alone it
    // breaks `supabase db push` outright.
    expect(
      compareMigrations(['20260101000000'], ['20260101000000', '20260807005457']),
    ).toMatchObject({ orphaned: ['20260807005457'], pending: [] })
  })

  it('singles out a pending migration older than what is already applied', () => {
    // The dangerous shape: db push would replay it *behind* newer applied work,
    // reverting whatever those later migrations changed.
    const result = compareMigrations(
      ['20260101000000', '20260806190324', '20260905000000'],
      ['20260101000000', '20260903000001'],
    )
    expect(result.outOfOrder).toEqual(['20260806190324'])
    // Out-of-order is a subset of pending, not a separate bucket.
    expect(result.pending).toContain('20260806190324')
    expect(result.pending).toContain('20260905000000')
  })

  it('does not call anything out of order against an empty history', () => {
    // A fresh database has no maximum to be behind.
    const result = compareMigrations(['20260101000000', '20260102000000'], [])
    expect(result.outOfOrder).toEqual([])
    expect(result.pending).toHaveLength(2)
  })

  it('sorts every bucket so output is stable between runs', () => {
    const result = compareMigrations(
      ['20260103000000', '20260101000000', '20260102000000'],
      [],
    )
    expect(result.pending).toEqual(['20260101000000', '20260102000000', '20260103000000'])
  })
})

describe('duplicateVersions', () => {
  it('catches two files claiming one version', () => {
    // 20260909000000 was used by pmps_booking_lead_stage and then again a day
    // later by lead_discovery_stage. `db push` applied the version once, so the
    // second file's SQL never ran — and no comparison against the history could
    // say so, because the version was recorded.
    expect(
      duplicateVersions([
        { version: '20260908000000', name: 'lead_legal_plan_billing', file: '20260908000000_lead_legal_plan_billing.sql' },
        { version: '20260909000000', name: 'pmps_booking_lead_stage', file: '20260909000000_pmps_booking_lead_stage.sql' },
        { version: '20260909000000', name: 'lead_discovery_stage', file: '20260909000000_lead_discovery_stage.sql' },
      ]),
    ).toEqual([
      {
        version: '20260909000000',
        files: [
          '20260909000000_lead_discovery_stage.sql',
          '20260909000000_pmps_booking_lead_stage.sql',
        ],
      },
    ])
  })

  it('says nothing about a repo where every version is used once', () => {
    expect(duplicateVersions(localMigrations(path.join(process.cwd(), 'supabase/migrations'))))
      .toEqual([])
  })
})

describe('nameMismatches', () => {
  it('catches a version already recorded for a different migration', () => {
    // The same silent skip across a merge boundary: the colliding file landed
    // earlier and is applied, so the new one reads as done the day it merges.
    expect(
      nameMismatches(
        [{ version: '20260909000000', name: 'lead_discovery_stage', file: '20260909000000_lead_discovery_stage.sql' }],
        [{ version: '20260909000000', name: 'pmps_booking_lead_stage' }],
      ),
    ).toEqual([
      {
        version: '20260909000000',
        file: '20260909000000_lead_discovery_stage.sql',
        recorded: 'pmps_booking_lead_stage',
      },
    ])
  })

  it('leaves an unapplied migration alone', () => {
    // Pending is not a mismatch — it is the normal state on a branch.
    expect(
      nameMismatches(
        [{ version: '20260912000000', name: 'brand_new', file: '20260912000000_brand_new.sql' }],
        [{ version: '20260911000000', name: 'crm_discovery_stage_sync' }],
      ),
    ).toEqual([])
  })
})

describe('recoveredMigrationFile', () => {
  it('rebuilds a file from the SQL the history recorded', () => {
    const { name, contents } = recoveredMigrationFile({
      version: '20260911000000',
      name: 'crm_discovery_stage_sync',
      statements: ['alter table public.leads add column discovery_at timestamptz', 'notify pgrst'],
    })

    expect(name).toBe('crm_discovery_stage_sync')
    expect(contents).toContain('alter table public.leads add column discovery_at timestamptz;')
    expect(contents).toContain('notify pgrst;')
    // Provenance matters more than the SQL: this was not authored here.
    expect(contents).toContain('Recovered from the migration history')
    expect(contents).toContain('safe to replay against a fresh')
  })

  it('does not double the semicolons Supabase already stored', () => {
    const { contents } = recoveredMigrationFile({
      version: '20260911000000',
      name: 'x',
      statements: ['select 1;'],
    })
    expect(contents).toContain('select 1;')
    expect(contents).not.toContain('select 1;;')
  })

  it('still names a file when the history row has none', () => {
    const { name } = recoveredMigrationFile({ version: '20260911000000', name: null, statements: [] })
    expect(name).toBe('recovered_from_history')
  })
})

describe('localVersions', () => {
  it('reads timestamped migrations and ignores everything else', () => {
    const versions = localVersions(path.join(process.cwd(), 'supabase/migrations'))
    expect(versions.length).toBeGreaterThan(100)
    expect(versions).toContain('20260904000000')
    // README.md and any non-timestamped file must not become a phantom version.
    expect(versions.every(v => /^\d{14}$/.test(v))).toBe(true)
  })

  it('returns them in applied order', () => {
    const versions = localVersions(path.join(process.cwd(), 'supabase/migrations'))
    expect(versions).toEqual([...versions].sort())
  })
})

describe('drift check wiring', () => {
  it('runs on a schedule, because a merge that skips the database is silent', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/db-migration-drift.yml'),
      'utf8',
    )
    expect(workflow).toContain('schedule:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('npm run check:migration-drift')
  })

  it('is registered as an npm script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts['check:migration-drift']).toContain('checkMigrationDrift.mjs')
  })

  it('gates a pull request on the collision that started all of this', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/db-migration-drift.yml'),
      'utf8',
    )
    // A duplicate version needs no database to detect and is never correct, so
    // the run that gates merging has to be the one that catches it.
    expect(workflow).toContain('pull_request')
  })
})

describe('the local invariants hold without credentials', () => {
  it('fails on a duplicate version even when the history is unreadable', () => {
    // The drift check skips when SUPABASE_ACCESS_TOKEN is absent. A collision is
    // wrong on its own terms, so it must not skip with it — otherwise the one
    // failure mode that is free to detect is the one CI would miss on a fork or
    // before the secrets are set.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'))
    const migrations = path.join(dir, 'supabase/migrations')
    fs.mkdirSync(migrations, { recursive: true })
    fs.writeFileSync(path.join(migrations, '20260101000000_first.sql'), '')
    fs.writeFileSync(path.join(migrations, '20260101000000_second.sql'), '')

    const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/checkMigrationDrift.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: '',
        SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_URL: '',
        SUPABASE_PROJECT_REF: '',
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('used by more than one file')
    expect(result.stdout).toContain('Skipping migration drift check')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
