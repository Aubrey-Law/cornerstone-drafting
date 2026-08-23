import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATTER_PIPELINE_STAGES, PIPELINE_TO_ENGINE } from '@/types/database'
import { LEAD_BOARD_COLUMNS, leadBoardColumn, type LeadBoardColumnKey } from '@/lib/leads/board'
import type { LeadListRow } from '@/lib/leads/viewTypes'

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')

function migrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()
}

/** The live definition is whichever migration last redefined it. */
function newestMigrationWith(needle: string): string {
  for (const name of migrationFiles().reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    if (sql.includes(needle)) return sql
  }
  throw new Error(`no migration defines ${needle}`)
}

/* ── matters.stage: the CHECK against the two TypeScript vocabularies ─────── */

function checkedStages(): string[] {
  const sql = newestMigrationWith('add constraint matters_stage_check')
  const start = sql.indexOf('check (stage is null or stage in (')
  const body = sql.slice(start, sql.indexOf('))', start))
  return [...body.matchAll(/'([a-z_]+)'/g)].map(match => match[1])
}

/* ── stage_sla: the rows the aging views join through ─────────────────────── */

function slaSeeds(): Array<{ stageKey: string; track: string; entity: string }> {
  const rows: Array<{ stageKey: string; track: string; entity: string }> = []
  for (const name of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    let from = 0
    for (;;) {
      const start = sql.toLowerCase().indexOf('insert into public.stage_sla', from)
      if (start === -1) break
      const end = sql.toLowerCase().indexOf('on conflict', start)
      const block = sql.slice(start, end === -1 ? undefined : end)
      for (const match of block.matchAll(/\(\s*'([a-z_]+)',\s*'([A-Z_]+)',\s*'(lead|matter)'/g)) {
        rows.push({ stageKey: match[1], track: match[2], entity: match[3] })
      }
      from = end === -1 ? sql.length : end
    }
  }
  if (!rows.length) throw new Error('no stage_sla seed rows found')
  return rows
}

/* ── crm_stage_slug_for_intake and the seeded CRM stages ──────────────────── */

/** The slugs the function can return, in the order its CASE tests them. */
function crmSlugLadder(): string[] {
  const sql = newestMigrationWith('function public.crm_stage_slug_for_intake')
  const start = sql.indexOf('select case', sql.indexOf('function public.crm_stage_slug_for_intake'))
  const body = sql.slice(start, sql.indexOf('\n  end', start))
  const slugs = [...body.matchAll(/then '([a-z_]+)'|else '([a-z_]+)'/g)].map(m => m[1] ?? m[2])
  if (!slugs.length) throw new Error('crm_stage_slug_for_intake() returned no slugs')
  return slugs
}

function seededCrmSlugs(): Set<string> {
  const slugs = new Set<string>()
  for (const name of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    let from = 0
    for (;;) {
      const start = sql.toLowerCase().indexOf('insert into public.cornerstone_crm_stages', from)
      if (start === -1) break
      const end = sql.toLowerCase().indexOf('on conflict', start)
      const block = sql.slice(start, end === -1 ? undefined : end)
      for (const match of block.matchAll(/\(\s*'[^']+',\s*'([a-z_]+)'/g)) slugs.add(match[1])
      from = end === -1 ? sql.length : end
    }
  }
  return slugs
}

describe('matters.stage vocabulary', () => {
  const checked = checkedStages()
  const sla = slaSeeds()
  const leadStages = sla.filter(row => row.entity === 'lead').map(row => row.stageKey)

  it('permits exactly the lead stages plus the matter stages', () => {
    expect([...checked].sort()).toEqual(
      [...new Set([...leadStages, ...MATTER_PIPELINE_STAGES])].sort(),
    )
  })

  it('gives every permitted lead stage a stage_sla row on the DEFAULT track', () => {
    // v_pipeline_aging joins stage_sla on the raw matters.stage for leads, and
    // the join is inner: a lead stage with no row drops the lead off the board
    // rather than showing it wrong.
    const defaultLeadKeys = new Set(
      sla.filter(row => row.entity === 'lead' && row.track === 'DEFAULT').map(row => row.stageKey),
    )
    for (const stage of checked.filter(stage => leadStages.includes(stage))) {
      expect(defaultLeadKeys.has(stage)).toBe(true)
    }
  })

  it('gives every permitted matter stage an engine key with a stage_sla row', () => {
    const defaultMatterKeys = new Set(
      sla.filter(row => row.entity === 'matter' && row.track === 'DEFAULT').map(row => row.stageKey),
    )
    for (const stage of MATTER_PIPELINE_STAGES) {
      const engineKey = PIPELINE_TO_ENGINE[stage]
      expect(engineKey, `${stage} maps to no engine key`).toBeTruthy()
      // `matter_closed` is the one key with no row on purpose — both aging
      // views exclude it before the join, so a closed matter is absent by
      // design rather than by an accidental gap.
      if (engineKey === 'matter_closed') {
        expect(defaultMatterKeys.has(engineKey)).toBe(false)
        continue
      }
      expect(defaultMatterKeys.has(engineKey), `${engineKey} has no stage_sla row`).toBe(true)
    }
  })
})

/* ── The lead board and the CRM mirror place the same lead ────────────────── */

/**
 * `crm_stage_slug_for_intake()` in SQL and `leadBoardColumn()` in TypeScript
 * read the same lead columns and answer the same question — where in the
 * pipeline this lead stands — and neither knows about the other. The board has
 * no discovery column and no needs-review column, so the correspondence is not
 * one to one; it is written out here so a new arm on either side has to be
 * placed deliberately rather than drifting.
 */
const SLUG_TO_COLUMN: Record<string, LeadBoardColumnKey> = {
  converted: 'hired',
  closed_lost: 'lost',
  declined: 'declined',
  engagement: 'engagement',
  intake_complete: 'intake_complete',
  intake_sent: 'intake_sent',
  // The board does not split discovery out of New, and a lead with no status
  // at all still has to land somewhere.
  discovery_call: 'new',
  needs_review: 'new',
  new_inquiry: 'new',
}

function lead(overrides: Partial<LeadListRow> = {}): LeadListRow {
  return {
    id: 'lead-1',
    full_name: 'Ada Lovelace',
    first_name: null,
    last_name: null,
    email: 'ada@example.com',
    phone: null,
    practice_area: 'EP',
    status: null,
    lead_status: 'lead',
    matter_id: null,
    intake_sent_at: null,
    intake_completed_at: null,
    engagement_status: null,
    engagement_sent_at: null,
    engagement_signed_at: null,
    engagement_fee_quoted: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: null,
    lead_urgency: null,
    taxable_estate: null,
    last_activity_at: null,
    ...overrides,
  }
}

const AT = '2026-07-02T00:00:00.000Z'

/** One lead per arm of the SQL CASE, in the order the CASE tests them. */
const LADDER: Array<{ slug: string; lead: LeadListRow }> = [
  { slug: 'converted', lead: lead({ lead_status: 'hired', engagement_sent_at: AT, intake_sent_at: AT }) },
  { slug: 'closed_lost', lead: lead({ lead_status: 'lost', engagement_sent_at: AT, intake_sent_at: AT }) },
  { slug: 'declined', lead: lead({ lead_status: 'declined', intake_sent_at: AT }) },
  { slug: 'needs_review', lead: lead({ lead_status: null }) },
  { slug: 'engagement', lead: lead({ engagement_sent_at: AT, intake_completed_at: AT, intake_sent_at: AT }) },
  { slug: 'intake_complete', lead: lead({ intake_completed_at: AT, intake_sent_at: AT }) },
  { slug: 'intake_sent', lead: lead({ intake_sent_at: AT }) },
  { slug: 'discovery_call', lead: lead() },
  { slug: 'new_inquiry', lead: lead() },
]

describe('lead pipeline vocabulary', () => {
  const ladder = crmSlugLadder()

  it('places every lead on a slug the CRM stage table actually holds', () => {
    // The mirror looks the stage up by slug; a slug with no row would set
    // stage_id to null and the lead would vanish from the CRM board.
    const seeded = seededCrmSlugs()
    for (const slug of ladder) expect(seeded.has(slug), `${slug} has no CRM stage row`).toBe(true)
  })

  it('gives every SQL slug a board column', () => {
    expect([...new Set(ladder)].sort()).toEqual(Object.keys(SLUG_TO_COLUMN).sort())
  })

  it('reaches every board column', () => {
    const reachable = new Set(Object.values(SLUG_TO_COLUMN))
    expect([...reachable].sort()).toEqual(LEAD_BOARD_COLUMNS.map(column => column.key).sort())
  })

  it('tests the same conditions in the same order', () => {
    expect(LADDER.map(entry => entry.slug)).toEqual(ladder)
  })

  it('puts a lead in the column its slug corresponds to', () => {
    for (const entry of LADDER) {
      expect(leadBoardColumn(entry.lead), entry.slug).toBe(SLUG_TO_COLUMN[entry.slug])
    }
  })
})
