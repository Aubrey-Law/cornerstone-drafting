import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261031000000_run_queue.sql'),
  'utf8',
)

describe('the run queue migration', () => {
  it('gives a run a heartbeat', () => {
    expect(sql).toMatch(/add column if not exists last_tick_at timestamptz/)
  })

  it('records which worker holds a run', () => {
    expect(sql).toMatch(/add column if not exists locked_by text/)
  })

  it('counts how many times a run has been handed back', () => {
    // A run that kills every worker it touches must stop being handed to the
    // next one; without a count there is nothing to stop on.
    expect(sql).toMatch(/add column if not exists reclaims integer not null default 0/)
  })

  it('claims a run without two workers getting the same one', () => {
    // The whole reason this is a function rather than a query: PostgREST has
    // no way to say `for update skip locked`.
    //
    // Anchored to the clause's actual position in the select — right after
    // the ordering and right before the limit — rather than a bare substring
    // match. The migration's own header comment names "for update skip
    // locked" too, in prose; a bare match would still pass with the real
    // clause deleted, as long as that comment survived.
    expect(sql).toMatch(/order by started_at\s*\n\s*for update skip locked\s*\n\s*limit 1/)
    expect(sql).toMatch(/create or replace function public\.claim_workflow_run/)
  })

  it('claims only one run, and the oldest', () => {
    expect(sql).toMatch(/order by started_at/)
    expect(sql).toMatch(/limit 1/)
  })

  it('runs the claim as its definer with a pinned search path', () => {
    // Matches claim_workflow_jobs in 20261004000000. An unpinned search_path
    // on a security definer function is how a definer becomes a foothold.
    expect(sql).toMatch(/security definer set search_path = pg_catalog, public/)
  })
})
