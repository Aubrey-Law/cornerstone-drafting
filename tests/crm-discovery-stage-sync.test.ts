import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20260911000000_crm_discovery_stage_sync.sql'

/** The body of a `create or replace function` block, so an assertion about one
 *  function cannot be satisfied by text that lives in another. */
function functionBody(source: string, signatureStart: string): string {
  const start = source.indexOf(signatureStart)
  expect(start, `missing definition: ${signatureStart}`).toBeGreaterThan(-1)
  const end = source.indexOf('\n$$;', start)
  expect(end, `unterminated definition: ${signatureStart}`).toBeGreaterThan(-1)
  return source.slice(start, end)
}

describe('CRM mirror sees the discovery stage', () => {
  it('drops the trigger column list that made BEFORE-stamped changes invisible', () => {
    const migration = read(MIGRATION)

    // A column-specific trigger fires off the statement's SET list, so a stage
    // rewritten by a BEFORE trigger on an unnamed column never reached the
    // mirror. `matters` carries three such stampers, so the list cannot simply
    // be extended and trusted to stay correct.
    expect(migration).toContain('drop trigger if exists sync_crm_opportunity_from_matter on public.matters')
    expect(migration).toMatch(
      /create trigger sync_crm_opportunity_from_matter\s+after insert or update\s+on public\.matters/,
    )
    expect(migration).not.toMatch(/after insert or update of[^\n]*on public\.matters/)
  })

  it('replaces the column list with a value guard that costs no I/O', () => {
    const body = functionBody(
      read(MIGRATION),
      'create or replace function public.sync_crm_opportunity_from_matter()',
    )

    // OLD is unassigned on INSERT, so the guard has to be UPDATE-only.
    expect(body).toContain("if tg_op = 'UPDATE'")
    for (const column of [
      'client_intake_id',
      'relationship_status',
      'hired_at',
      'lost_at',
      'stage',
      'stage_entered_at',
    ]) {
      expect(body, `the short-circuit must compare ${column}`).toMatch(
        new RegExp(`new\\.${column} is not distinct from old\\.${column}`),
      )
    }
    // The guard has to precede the lookups, or it saves nothing.
    expect(body.indexOf("if tg_op = 'UPDATE'")).toBeLessThan(body.indexOf('select * into v_intake'))
  })

  it('lets a stage_entered_at-only move through the row filter', () => {
    const body = functionBody(
      read(MIGRATION),
      'create or replace function public.sync_crm_opportunity_from_matter()',
    )

    // Pinning the clock to the call date moves stage_entered_at and nothing
    // else; without this term the UPDATE matches no rows even when it fires.
    expect(body).toMatch(
      /or \(new\.stage_entered_at is not null and stage_entered_at is distinct from new\.stage_entered_at\)/,
    )
  })

  it('models discovery_call as a CRM stage between new and intake_sent', () => {
    const migration = read(MIGRATION)

    expect(migration).toMatch(/\('Discovery Call', 'discovery_call', 15, true, false, false\)/)
    expect(migration).toContain('on conflict (slug) do update set')

    const slug = functionBody(migration, 'create or replace function public.crm_stage_slug_for_intake(')
    expect(slug).toContain("when p_discovery_call_at is not null then 'discovery_call'")
    // Order is the contract: discovery ranks below intake_sent and above new.
    expect(slug.indexOf("then 'intake_sent'")).toBeLessThan(slug.indexOf("then 'discovery_call'"))
    expect(slug.indexOf("then 'discovery_call'")).toBeLessThan(slug.indexOf("else 'new_inquiry'"))
  })

  it('drops the old 7-argument slug function so callers cannot bind to it', () => {
    const migration = read(MIGRATION)

    // `create or replace` with an extra parameter creates an overload, and an
    // exact 7-argument match would keep winning over the new default.
    expect(migration).toMatch(
      /drop function if exists public\.crm_stage_slug_for_intake\(\s*text, text, timestamptz, timestamptz, text, timestamptz, text\s*\)/,
    )
    expect(migration).toContain('p_discovery_call_at timestamptz default null')
  })

  it('feeds the anchor in from both writers of opportunities.stage_id', () => {
    const migration = read(MIGRATION)

    // The matter-side mirror reads it off the row under the trigger.
    const mirror = functionBody(migration, 'create or replace function public.sync_crm_opportunity_from_matter()')
    expect(mirror).toContain('new.discovery_call_at')

    // The intake-side writer would otherwise recompute a discovery lead back to
    // new_inquiry on the next client_intake touch.
    const person = functionBody(migration, 'create or replace function public.sync_crm_person_from_intake()')
    expect(person).toContain('v_matter.discovery_call_at')
  })

  it('backfills only the matters that carry the anchor', () => {
    const migration = read(MIGRATION)
    const backfill = migration.slice(migration.indexOf('update public.cornerstone_crm_opportunities o'))

    expect(backfill).toContain('m.discovery_call_at is not null')
    expect(backfill).toContain('m.discovery_call_at')
    // A blanket recompute would overwrite stages an attorney moved by hand.
    expect(backfill).toMatch(/o\.stage_id is distinct from s\.id/)
  })

  it('keeps the trigger functions unreachable from the API roles', () => {
    const migration = read(MIGRATION)

    for (const fn of ['sync_crm_opportunity_from_matter', 'sync_crm_person_from_intake']) {
      expect(migration).toContain(
        `revoke all on function public.${fn}() from public, anon, authenticated;`,
      )
    }
    expect(migration).toContain("notify pgrst, 'reload schema';")
  })

  it('reads a booked planning session as intake_complete', () => {
    const slug = functionBody(
      read(MIGRATION),
      'create or replace function public.crm_stage_slug_for_intake(',
    )

    expect(slug).toContain('p_pmps_at timestamptz default null')
    // stamp_lead_pmps_stage moves the pipeline stage off the same column, so
    // the CRM has to agree or a booked lead mirrors one rung low.
    expect(slug).toMatch(/or p_pmps_at is not null then 'intake_complete'/)
    // A floor, not a ceiling.
    expect(slug.indexOf("then 'engagement'")).toBeLessThan(slug.indexOf("then 'intake_complete'"))
  })

  it('short-circuits on the anchors themselves, not only the derived stage', () => {
    const body = functionBody(
      read(MIGRATION),
      'create or replace function public.sync_crm_opportunity_from_matter()',
    )

    // Both stampers decline to move a lead already further along, and
    // stamp_lead_pmps_stage is absent from this branch entirely — in both cases
    // the anchor moves while `stage` does not, and the slug still changes.
    for (const column of ['discovery_call_at', 'pmps_at']) {
      expect(body, `the short-circuit must compare ${column}`).toMatch(
        new RegExp(`new\\.${column} is not distinct from old\\.${column}`),
      )
    }
  })

  it('redefines ensure_lead_matter with both stage ladders', () => {
    const body = functionBody(
      read(MIGRATION),
      'create or replace function public.ensure_lead_matter()',
    )

    // Two migrations own this function and neither knows about the other. This
    // one runs last, so it has to carry the discovery rung AND the PMPS floor
    // or it silently reverts whichever it omits.
    expect(body).toContain("when v_discovery_call_at is not null then 'discovery_call'")
    expect(body).toMatch(/if v_pmps_at is not null/)
    expect(body).toContain("v_stage := 'intake_completed'")
    expect(body).toContain('m.discovery_call_at, m.pmps_at')

    // The floor must not promote a lead that is already further along.
    expect(body).toMatch(/v_stage in \('new_lead', 'discovery_call', 'intake_sent'\)/)

    // pipeline_stage_rank() lives only in main's migration; referencing it here
    // would resolve at run time and fail on this branch.
    expect(body).not.toContain('pipeline_stage_rank')
  })

  it('backfills planning-session rows as well as discovery rows', () => {
    const migration = read(MIGRATION)
    const backfill = migration.slice(migration.indexOf('update public.cornerstone_crm_opportunities o'))

    expect(backfill).toMatch(/\(m\.discovery_call_at is not null or m\.pmps_at is not null\)/)
    expect(backfill).toContain('m.pmps_at')
  })

  it('runs after the migration that creates the discovery stage', () => {
    const dir = path.join(process.cwd(), 'supabase/migrations')
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()
    const fixName = path.basename(MIGRATION)
    const discovery = names.find((n) => n.endsWith('_lead_discovery_stage.sql'))

    expect(names).toContain(fixName)
    expect(discovery).toBeDefined()
    // This migration reads matters.discovery_call_at and renumbers nothing on
    // its own; applied first it would seed a CRM stage for a pipeline stage
    // that does not exist yet.
    expect(fixName > discovery!).toBe(true)
  })

  it('leaves no two migrations sharing a timestamp', () => {
    // Both discovery migrations were renumbered off 20260909000000, which main
    // had already claimed for the PMPS booking stage. Duplicate timestamps
    // order non-deterministically, so guard the whole directory, not this pair.
    const dir = path.join(process.cwd(), 'supabase/migrations')
    const stamps = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .map((n) => n.split('_')[0])

    expect(stamps).toHaveLength(new Set(stamps).size)
  })
})
