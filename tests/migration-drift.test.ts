import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareMigrations, localVersions } from '@/scripts/checkMigrationDrift.mjs'

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
})
