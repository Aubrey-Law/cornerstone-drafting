import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261030000000_run_steps.sql'),
  'utf8',
)

describe('the run steps migration', () => {
  it('gives a run at most one step per unit', () => {
    // Two rows for the same unit would make "which step failed" unanswerable,
    // and retry would run it twice.
    expect(sql).toMatch(/unique \(run_id, unit_id\)/)
  })

  it('lets a step say how many attempts it has had', () => {
    expect(sql).toMatch(/attempts integer not null default 0/)
  })

  it('keeps a step pointing at what it produced, and survives that finding going', () => {
    // A retry deletes the superseded finding. The step must not go with it --
    // its attempt count and error history are the record of what happened.
    expect(sql).toMatch(/finding_id uuid references public\.workflow_findings\(id\) on delete set null/)
  })

  it('drops a run’s steps with the run', () => {
    expect(sql).toMatch(/run_id uuid not null references public\.workflow_runs\(id\) on delete cascade/)
  })

  it('pins the evidence a field audit ran against', () => {
    // A bare substring match would still pass if resolved_inputs landed on
    // the wrong table or with the wrong type -- anchored to the actual
    // alter statement so it guards the column, not just the word.
    expect(sql).toMatch(
      /alter table public\.workflow_runs\s*\n\s*add column if not exists resolved_inputs jsonb;/,
    )
  })

  it('protects the new table with row level security', () => {
    expect(sql).toContain('alter table public.workflow_run_steps enable row level security')
  })
})
