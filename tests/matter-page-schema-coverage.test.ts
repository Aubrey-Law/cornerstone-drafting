import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMatterPlanMirror } from '@/lib/matter/planMirror'
import { resolveDraftingDate } from '@/lib/matter/draftingDates'
import { isCoupleMatter, normalizeMatterType } from '@/lib/matter/matterType'
import type { DesignSheet, MatterContact } from '@/types/database'

const matterDir = path.join(process.cwd(), 'app/admin/matters/[id]')

function contact(id: string, first: string, last: string): MatterContact {
  return { id, first_name: first, last_name: last }
}

function sheet(overrides: Partial<DesignSheet> = {}): DesignSheet {
  return {
    plan_type: 'pour_over',
    trust_name: 'White Family Trust',
    trustee_slots: [
      { id: 's1', contact_id: 'c-walter', is_co: false, order: 0 },
      { id: 's2', contact_id: 'c-skyler', is_co: true, order: 0 },
      { id: 's3', contact_id: 'c-marie', is_co: false, order: 1 },
    ],
    ...overrides,
  } as unknown as DesignSheet
}

const CONTACTS = [
  contact('c-walter', 'Walter', 'White'),
  contact('c-skyler', 'Skyler', 'White'),
  contact('c-marie', 'Marie', 'Schrader'),
]

describe('matter type', () => {
  it('reads couple / individual and tolerates the joint and single synonyms', () => {
    expect(normalizeMatterType('couple')).toBe('couple')
    expect(normalizeMatterType('Joint')).toBe('couple')
    expect(normalizeMatterType('individual')).toBe('individual')
    expect(normalizeMatterType('single')).toBe('individual')
    expect(normalizeMatterType('')).toBeNull()
  })

  it('gates the spouse surfaces on matter type, not marital status', () => {
    expect(isCoupleMatter('couple')).toBe(true)
    expect(isCoupleMatter('individual')).toBe(false)
  })

  it('keeps participant composition unresolved when matter type is unset', () => {
    expect(isCoupleMatter(null)).toBe(false)
  })
})

describe('drafting dates', () => {
  const details = { scheduled_signing_date: '2026-09-18T12:00:00.000Z' }

  it('derives drafts due / review / revisions at 18, 14 and 7 days before signing', () => {
    expect(resolveDraftingDate(details, 'drafts_due')).toEqual({ value: '2026-08-31', derived: true })
    expect(resolveDraftingDate(details, 'drafts_review')).toEqual({ value: '2026-09-04', derived: true })
    expect(resolveDraftingDate(details, 'revisions')).toEqual({ value: '2026-09-11', derived: true })
  })

  it('lets an explicitly stored value win over the derivation', () => {
    expect(resolveDraftingDate({ ...details, client_review_date: '2026-09-01' }, 'drafts_review'))
      .toEqual({ value: '2026-09-01', derived: false })
  })

  it('returns nothing when there is no anchor and no stored value', () => {
    expect(resolveDraftingDate({}, 'drafts_due')).toEqual({ value: '', derived: false })
  })
})

describe('plan mirror', () => {
  it('resolves each fiduciary role to primary and successor, folding co-agents in', () => {
    const mirror = buildMatterPlanMirror(sheet(), CONTACTS, null)
    const trustee = mirror.fiduciaries.find(role => role.key === 'trustee_slots')
    expect(trustee?.primary).toBe('Walter White & Skyler White')
    expect(trustee?.successor).toBe('Marie Schrader')
  })

  it('always reports all ten roles so an empty one still reads as unnamed', () => {
    const mirror = buildMatterPlanMirror(sheet(), CONTACTS, null)
    expect(mirror.fiduciaries).toHaveLength(10)
    expect(mirror.fiduciaries.find(role => role.key === 'guardian_slots')?.primary).toBeNull()
  })

  it('resolves the client and spouse sentinels to their real names', () => {
    const mirror = buildMatterPlanMirror(
      sheet({
        poa_slots: [{ id: 'p1', contact_id: '__design_sheet_spouse__', is_co: false, order: 0 }],
      } as unknown as Partial<DesignSheet>),
      CONTACTS,
      null,
      { clientName: 'Walter White', spouseName: 'Skyler White' },
    )
    expect(mirror.fiduciaries.find(role => role.key === 'poa_slots')?.primary).toBe('Skyler White')
  })

  it('flags real estate from design sheet assets and pets from the pet-care option', () => {
    const mirror = buildMatterPlanMirror(
      sheet({
        assets: [{ id: 'a1', category: 'real_property', description: '', institution: '', estimated_value: 1, notes: '' }],
        pet_care_option: 'pet_trust',
      } as unknown as Partial<DesignSheet>),
      CONTACTS,
      null,
    )
    expect(mirror.hasRealEstate).toBe(true)
    expect(mirror.hasPets).toBe(true)
  })

  it('reads credit shelter from a two-trust plan or the legacy column', () => {
    expect(buildMatterPlanMirror(sheet({ spouse_trust_name: 'Skyler Trust' } as Partial<DesignSheet>), [], null).creditShelter).toBe(true)
    expect(buildMatterPlanMirror(sheet(), [], { ep_separate_trusts: true }).creditShelter).toBe(true)
    expect(buildMatterPlanMirror(sheet(), [], { credit_shelter_provisions: 'disclaimer' }).creditShelter).toBe(true)
    expect(buildMatterPlanMirror(sheet(), [], null).creditShelter).toBe(false)
  })

  it('survives a matter with no design sheet at all', () => {
    const mirror = buildMatterPlanMirror(null, [], null)
    expect(mirror.planType).toBeNull()
    expect(mirror.fiduciaries.every(role => role.primary === null)).toBe(true)
  })
})

describe('design-sheet-owned fields', () => {
  it('are rejected by the matter_details PATCH route rather than only disabled in the UI', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matter-details/route.ts'),
      'utf8',
    )
    expect(route).toContain('DESIGN_SHEET_OWNED_FIELDS')
    for (const field of ['plan_type', 'trust_name', 'credit_shelter_provisions']) {
      expect(route).toMatch(new RegExp(`DESIGN_SHEET_OWNED_FIELDS[\\s\\S]*'${field}'`))
    }
    // The allowlist must not also carry them, or ordering would decide the outcome.
    const writable = route.slice(route.indexOf('WRITABLE_FIELDS'), route.indexOf('DESIGN_SHEET_OWNED_FIELDS'))
    expect(writable).not.toContain("'plan_type'")
    expect(writable).not.toContain("'credit_shelter_provisions'")
  })
})

describe('matter page surfaces', () => {
  it('uses the focus brief with communication activity and a read-only summary', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')
    const overview = fs.readFileSync(path.join(matterDir, 'MatterOverviewWork.tsx'), 'utf8')
    expect(client).toContain('<MatterOverviewWork')
    expect(client).toContain('<MatterOverviewSidebar')
    expect(client).not.toContain('<MatterOverviewFacts')
    expect(client).not.toContain('<MatterOverviewStats')
    expect(overview).toContain('aria-label="Next action"')
    expect(overview).toContain('aria-label="Matter communication and activity"')
    expect(overview).toContain('aria-label="Matter summary"')
    expect(overview).toContain('nextMatterMilestone(matter, details)')
  })

  it('drops the portal uploads card', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')
    expect(client).not.toContain('MatterPortalUploadsCard')
    expect(fs.existsSync(path.join(matterDir, 'MatterPortalUploadsCard.tsx'))).toBe(false)
  })

  it('gives Documents an Unreviewed filter and a per-row review action', () => {
    const docs = fs.readFileSync(path.join(matterDir, 'MatterDocumentsTab.tsx'), 'utf8')
    expect(docs).toContain("{ value: 'unreviewed', label: 'Unreviewed'")
    expect(docs).toContain('setDocumentReviewed')
    expect(docs).toContain('Mark reviewed')
  })

  it('shows the fiduciary mirror on People', () => {
    const people = fs.readFileSync(path.join(matterDir, 'MatterPeopleTab.tsx'), 'utf8')
    expect(people).toContain('<MatterFiduciaryCard')
  })
})
