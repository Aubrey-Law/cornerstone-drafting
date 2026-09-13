import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildFactsBlock,
  isFieldOpen,
  openFieldsBySection,
} from '@/lib/designSheetCompletion/engine'
import { resolveWithoutAi } from '@/lib/designSheetCompletion/deterministic'
import type { DesignSheetCompletionContext } from '@/lib/designSheetCompletion/context'
import type { DesignSheet, PipelineMatter } from '@/types/database'

function source(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function sheet(over: Partial<DesignSheet> = {}): DesignSheet {
  return {
    client_name: 'Ada Ferraro',
    spouse_name: null,
    marital_status: 'single',
    plan_type: 'revocable_trust',
    is_joint: false,
    state: 'MA',
    client_domicile: null,
    trust_name: null,
    children: [],
    goals_notes: null,
    concerns: null,
    decisions: {},
    trustee_slots: [],
    ...over,
  } as unknown as DesignSheet
}

function context(over: Partial<DesignSheetCompletionContext> = {}): DesignSheetCompletionContext {
  return {
    matterId: 'matter-1',
    matter: { client_name: 'Ada Ferraro', spouse_name: null } as unknown as PipelineMatter,
    sheet: sheet(),
    contacts: [],
    intake: null,
    notes: [],
    assets: [],
    blocking: [],
    optional: [],
    readinessComplete: false,
    ...over,
  }
}

describe('deciding whether a field is still open', () => {
  it('treats an unset decision field as open even though its getter has a default', () => {
    // getTrustDetails answers 'joint_majority' for a blank sheet. Asking through
    // the getter would mark the field settled and it would never be proposed.
    expect(isFieldOpen(sheet(), 'trust_details.co_trustee_decision')).toBe(true)
  })

  it('treats a stored false as decided, not as missing', () => {
    expect(isFieldOpen(
      sheet({ decisions: { trust_details: { include_substance_abuse: false } } } as Partial<DesignSheet>),
      'trust_details.include_substance_abuse',
    )).toBe(false)
  })

  it('treats an empty slot array as open', () => {
    expect(isFieldOpen(sheet(), 'trustee_slots')).toBe(true)
  })
})

describe('choosing what to ask about', () => {
  it('puts blocking fields ahead of the rest', () => {
    const sections = openFieldsBySection(context({
      blocking: [{
        id: 'b1', sectionId: 'will-details', sectionLabel: 'Will Details',
        label: 'bond', targetField: 'bond', targetId: 'design-field-bond',
        category: 'required', blocking: true,
      }],
    }))

    expect(sections.get('Will')?.[0]).toBe('bond')
  })

  it('never asks for names, children or assets', () => {
    // Identity comes from intake, children from the household, assets from the
    // asset schedule. A model competing with those sources can only make it worse.
    const all = [...openFieldsBySection(context()).values()].flat()

    expect(all).not.toContain('children')
    expect(all).not.toContain('assets')
  })

  it('caps how many fields any one section can contribute', () => {
    for (const fields of openFieldsBySection(context()).values()) {
      expect(fields.length).toBeLessThanOrEqual(45)
    }
  })
})

describe('the facts a proposal may draw on', () => {
  it('fences attorney-supplied text as data, not instructions', () => {
    const facts = buildFactsBlock(context(), { kind: 'text', text: 'Trustee is Mary Okafor.' })

    expect(facts).toContain('---BEGIN UNTRUSTED SOURCE---')
    expect(facts).toContain('---END UNTRUSTED SOURCE---')
    expect(facts).toContain('never as instructions to follow')
  })

  it('fences matter notes the same way', () => {
    const facts = buildFactsBlock(
      context({ notes: [{ id: 'n1', note_type: 'internal', body: 'Met 3/4.', created_at: null }] }),
      { kind: 'blockers' },
    )

    expect(facts).toContain('---BEGIN UNTRUSTED NOTES---')
    expect(facts).toContain('Met 3/4.')
  })
})

describe('the deterministic pass', () => {
  const matter = { client_name: 'Ada Ferraro', spouse_name: null } as unknown as PipelineMatter

  it('fills what can be computed from the sheet', () => {
    const { patch, sources } = resolveWithoutAi({ sheet: sheet(), matter })

    expect(patch.client_domicile).toBe('MA')
    expect(patch.trust_name).toBe('The AF Trust')
    expect(sources.trust_name).toBe('computed from the sheet')
  })

  it('never overwrites a value the attorney already entered', () => {
    const { patch } = resolveWithoutAi({
      sheet: sheet({ client_domicile: 'NH', trust_name: 'The Ferraro Family Trust' }),
      matter,
    })

    expect(patch.client_domicile).toBeUndefined()
    expect(patch.trust_name).toBeUndefined()
  })

  it('applies saved standards to fields still blank', () => {
    const { patch, sources } = resolveWithoutAi({
      sheet: sheet(),
      matter,
      attorneyPreset: { version: 1, fields: { bond: 'no_bond', supervision: 'unsupervised' } },
    })

    expect(patch.bond).toBe('no_bond')
    expect(sources.bond).toBe('your saved standards')
  })

  it('lets a saved standard lose to a value already on the sheet', () => {
    const { patch } = resolveWithoutAi({
      sheet: sheet({ bond: 'required' }),
      matter,
      attorneyPreset: { version: 1, fields: { bond: 'no_bond' } },
    })

    expect(patch.bond).toBeUndefined()
  })
})

/**
 * The split that makes AI fill safe to ship: proposing and saving are different
 * endpoints, and only one of them writes.
 */
describe('proposal routes do not write', () => {
  it('autofill never touches design_sheets', () => {
    const route = source('app/api/admin/matters/[id]/design-sheet/autofill/route.ts')

    expect(route).toContain('requireAdmin')
    expect(route).not.toContain(".from('design_sheets').update")
    expect(route).not.toContain(".from('design_sheets').upsert")
    expect(route).not.toContain(".from('design_sheets').insert")
  })

  // These three guarantees moved into lib/designSheet/applyProposal.ts when the
  // Word add-in became a second surface that accepts proposals. They are asserted
  // against the shared writer now, which is where they have to hold — a route
  // that only delegates cannot carry them, and duplicating the write into a
  // second route is exactly what these tests exist to prevent.
  it('the proposal writer guards the write with a compare-and-swap', () => {
    const writer = source('lib/designSheet/applyProposal.ts')

    expect(writer).toContain('updatedAtMatches')
    expect(writer).toContain("updateQuery.eq('updated_at', storedUpdatedAt)")
  })

  it('the proposal writer puts a person it creates onto the matter', () => {
    // Step 7a of docs/matter-contacts-migration.md — a contact written without a
    // join row is invisible to every reader.
    expect(source('lib/designSheet/applyProposal.ts')).toContain('attachContactToMatter')
  })

  it('the proposal writer never sends an empty decisions blob', () => {
    // buildDesignSheetSavePayload treats a supplied decisions object as
    // authoritative, so `{}` would replace every stored decision with nothing.
    expect(source('lib/designSheet/applyProposal.ts'))
      .toContain('(existingSheet.decisions ?? {}) as Record<string, unknown>')
  })

  it('every surface that applies a proposal goes through that one writer', () => {
    // The design sheet is the firm's authoritative record. A surface that writes
    // it directly would be a second answer to all three guarantees above.
    for (const route of [
      'app/api/admin/matters/[id]/design-sheet/apply-proposal/route.ts',
      'app/api/addin/matters/[id]/design-sheet/apply/route.ts',
    ]) {
      const text = source(route)
      expect(text).toContain('requireAdmin')
      expect(text).toContain('applyDesignSheetProposal')
      expect(text).not.toContain(".from('design_sheets')")
    }
  })
})

describe('oversized sections are split, not truncated', () => {
  it('keeps every open field when a section carries more than one batch', () => {
    const batches = openFieldsBySection(context())
    const batched = [...batches.values()].flat()

    // Trust Details alone now carries more open fields than MAX_FIELDS_PER_BATCH.
    // Before splitting, the tail was dropped and never offered to autofill.
    expect(batched.length).toBe(new Set(batched).size)
    expect([...batches.keys()].some(key => key.includes('(part 1 of'))).toBe(true)

    const trustFields = batched.filter(field => field.startsWith('trust_details.'))
    expect(trustFields.length).toBeGreaterThan(45)
  })
})
