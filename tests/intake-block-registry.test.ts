import { describe, expect, it } from 'vitest'
import { getStepById, getStepIssues } from '@/lib/intakeSections'
import { INTAKE_PARITY_CASES } from '@/tests/fixtures/intakeFormParity'
import {
  INTAKE_BLOCK_REGISTRY,
  evaluateIntakeBlock,
  getIntakeBlock,
  getIntakeBlockPersistenceSnapshot,
  persistIntakeBlockOnLeave,
  type IntakeBlockPersistenceContext,
} from '@/lib/intake/forms/blockRegistry'

const EXPECTED_BLOCKS = [
  'address', 'spouse_details', 'children', 'financial_assets',
  'planning_objectives', 'existing_document_uploads', 'additional_contacts',
  'client_fiduciaries', 'spouse_fiduciaries', 'guardian', 'college_parents',
  'college_agents', 'college_hipaa_recipients', 'review_submit',
  'attorney_plan_structure', 'attorney_documents',
] as const

describe('canonical intake block catalog', () => {
  it('exposes only the approved blocks and refuses storage-key configuration', () => {
    expect(Object.keys(INTAKE_BLOCK_REGISTRY).sort()).toEqual([...EXPECTED_BLOCKS].sort())
    for (const id of EXPECTED_BLOCKS) {
      const block = getIntakeBlock(id)
      expect(block.id).toBe(id)
      expect(block.audiences).toEqual(id.startsWith('attorney_') ? ['staff_only'] : ['client_and_staff', 'staff_only'])
      expect(block.configSchema.safeParse({}).success).toBe(true)
      expect(block.configSchema.safeParse({ persistenceKey: 'arbitrary' }).success).toBe(false)
      expect(typeof block.evaluate).toBe('function')
      expect(typeof block.persistOnLeave).toBe('boolean')
    }
    expect(() => getIntakeBlock('arbitrary' as never)).toThrow(/Unknown intake block/)
    expect(() => evaluateIntakeBlock('financial_assets', { persistenceKey: 'other' }, {})).toThrow()
  })

  it('keeps the estate and college address wording and legacy address fallback', () => {
    expect(evaluateIntakeBlock('address', {}, {}).issues.map((i) => i.message)).toEqual([
      'Enter your street address.', 'Enter your city.', 'Enter your state.',
      'Enter your ZIP code.', 'Select your Massachusetts county.',
    ])
    expect(evaluateIntakeBlock('address', { profile: 'college' }, {}).issues[0].message)
      .toBe("Enter the student's permanent street address.")
    expect(evaluateIntakeBlock('address', {}, { address_line1: '1 Main', city: 'Boston', state: 'MA', zip: '02108', county: 'Suffolk' }))
      .toEqual({ complete: true, issues: [] })
  })

  it('can leave county to a separate canonical item without weakening the default address profile', () => {
    const address = { street_address: '1 Main', city: 'Boston', state: 'MA', zip: '02108' }
    expect(evaluateIntakeBlock('address', { includeCounty: false }, address)).toEqual({ complete: true, issues: [] })
    expect(evaluateIntakeBlock('address', {}, address).complete).toBe(false)
    expect(evaluateIntakeBlock('address', { includeCounty: true }, address).complete).toBe(false)
    expect(getIntakeBlock('address').configSchema.safeParse({ includeCounty: 'no' }).success).toBe(false)
  })

  it('evaluates hydrated spouse and child contacts without changing them', () => {
    const spouse = { id: 'matter-spouse', first_name: 'Pat', last_name: 'Example', date_of_birth: '1980-01-01' }
    const child = { id: 'matter-child', first_name: 'Lee', last_name: 'Example' }
    const data = Object.freeze({ _spouse: Object.freeze(spouse), _children: Object.freeze([Object.freeze(child)]), has_minor_children: true })
    expect(evaluateIntakeBlock('spouse_details', {}, data)).toEqual({ complete: true, issues: [] })
    expect(evaluateIntakeBlock('children', {}, data)).toEqual({ complete: false, issues: [{ message: 'Enter date of birth for child 1.', severity: 'error' }] })
    expect(evaluateIntakeBlock('children', {}, { ...data, has_minor_children: false }))
      .toEqual({ complete: true, issues: [{ message: 'Enter date of birth for child 1.', severity: 'warning' }] })
    expect(data._children[0]).toEqual(child)
  })

  it('reads stored projections and honors each existing review-choice rule', () => {
    const named = [{ first_name: 'Pat', last_name: 'Example' }]
    const data = { fiduciary_entries: { children: named, additional_contacts: named, fid_poa_client: named, fid_hcp_client: named, fid_personal_rep_client: named, fid_trustee_client: named } }
    expect(evaluateIntakeBlock('children', {}, data).complete).toBe(true)
    expect(evaluateIntakeBlock('additional_contacts', {}, data).complete).toBe(true)
    expect(evaluateIntakeBlock('client_fiduciaries', {}, data)).toEqual({ complete: true, issues: [] })
    const review = { review_choices: { fiduciaries: 'discuss_with_attorney', guardian: 'not_provided_yet', cp_agents: 'discuss_with_attorney' } }
    expect(evaluateIntakeBlock('client_fiduciaries', {}, review).complete).toBe(true)
    expect(evaluateIntakeBlock('client_fiduciaries', {}, review).issues).toHaveLength(4)
    expect(evaluateIntakeBlock('guardian', {}, { ...review, has_minor_children: true })).toEqual({ complete: true, issues: [] })
    expect(evaluateIntakeBlock('college_agents', {}, review)).toEqual({ complete: true, issues: [] })
    expect(evaluateIntakeBlock('college_hipaa_recipients', {}, review).issues).toEqual([])
  })

  it('does not introduce submission blockers for missing compound answers', () => {
    for (const id of EXPECTED_BLOCKS) {
      expect(evaluateIntakeBlock(id, {}, {}).issues.some((i) => i.blocksSubmission)).toBe(false)
    }
    expect(evaluateIntakeBlock('financial_assets', {}, { financial_details: { asset_types: ['real_estate'] } })).toEqual({ complete: true, issues: [] })
    expect(evaluateIntakeBlock('planning_objectives', {}, { planning_objectives: '{"why_now":"Peace of mind"}' })).toEqual({ complete: true, issues: [] })
    expect(evaluateIntakeBlock('review_submit', {}, { status: 'submitted' }).complete).toBe(true)
  })

  it('evaluates college parents and nested HIPAA data with the existing warnings', () => {
    expect(evaluateIntakeBlock('college_parents', {}, { _additional_contacts: [{ first_name: 'Alma', last_name: 'Example' }] }))
      .toEqual({ complete: true, issues: [{ message: 'Add a phone number or email for Alma — an agent we cannot reach is not much use in an emergency.', severity: 'warning' }] })
    expect(evaluateIntakeBlock('college_hipaa_recipients', {}, { college_prep_details: { hipaa_recipients: [{ name: 'Alma Example' }] } }).issues).toEqual([])
  })

  it('retains legacy completion and issue behavior for contact-backed sections', () => {
    const sections = [
      ['spouse', 'spouse_details'], ['children', 'children'],
      ['additional_contacts', 'additional_contacts'], ['fiduciaries', 'client_fiduciaries'],
      ['spouse_fiduciaries', 'spouse_fiduciaries'], ['guardian', 'guardian'],
      ['cp_parents', 'college_parents'],
    ] as const
    for (const { data } of INTAKE_PARITY_CASES) {
      for (const [sectionId, blockId] of sections) {
        const evaluated = evaluateIntakeBlock(blockId, {}, data)
        expect(evaluated.complete, `${sectionId} completion`).toBe(getStepById(sectionId)?.isComplete(data))
        expect(evaluated.issues, `${sectionId} issues`).toEqual(getStepIssues(sectionId, data).map(({ message, severity }) => ({ message, severity })))
      }
      const agents = evaluateIntakeBlock('college_agents', {}, data)
      expect(agents.complete).toBe(getStepById('cp_agents')?.isComplete(data))
      expect([...agents.issues, ...evaluateIntakeBlock('college_hipaa_recipients', {}, data).issues])
        .toEqual(getStepIssues('cp_agents', data).map(({ message, severity }) => ({ message, severity })))
    }
  })
})

describe('canonical block persistence on section leave', () => {
  function context() {
    const writes: unknown[][] = []
    const adapters: IntakeBlockPersistenceContext = {
      saveSpouse: async (value) => { writes.push(['spouse', value]) },
      saveChildren: async (value) => { writes.push(['children', value]) },
      saveAdditionalContacts: async (value) => { writes.push(['additional', value]) },
      saveFiduciaries: async (entries, role, party) => { writes.push(['fiduciaries', entries, role, party]) },
    }
    return { writes, adapters }
  }

  it('sends exactly the hydrated contact objects to the existing scoped save adapters', async () => {
    const { writes, adapters } = context()
    const spouse = { id: 'matter-spouse', first_name: 'Pat' }
    const child = { id: 'matter-child', first_name: 'Lee' }
    const nominee = { id: 'matter-nominee', first_name: 'Alma' }
    await persistIntakeBlockOnLeave('spouse_details', { _spouse: spouse }, adapters)
    await persistIntakeBlockOnLeave('children', { _children: [child] }, adapters)
    await persistIntakeBlockOnLeave('college_parents', { _additional_contacts: [nominee] }, adapters)
    expect(writes).toEqual([['spouse', spouse], ['children', [child]], ['additional', [nominee]]])
  })

  it('uses fixed role and party mappings and retains the existing named-entry save rule', async () => {
    const { writes, adapters } = context()
    const entry = { id: 'matter-contact', first_name: 'Pat', last_name: '', priority: 1 }
    await persistIntakeBlockOnLeave('spouse_fiduciaries', { _fid_poa_spouse: [entry, { first_name: '', last_name: '', priority: 2 }], _fid_poa_client: [entry] }, adapters)
    await persistIntakeBlockOnLeave('college_agents', { _fid_poa_client: [entry], _fid_hcp_client: [entry] }, adapters)
    expect(writes).toEqual([
      ['fiduciaries', [entry], 'poa', 'spouse'],
      ['fiduciaries', [entry], 'poa', 'client'],
      ['fiduciaries', [entry], 'hcp', 'client'],
    ])
  })

  it('does not save non-contact blocks and propagates adapter failure', async () => {
    const { writes, adapters } = context()
    await persistIntakeBlockOnLeave('financial_assets', { persistenceKey: 'other', _children: [{}] }, adapters)
    expect(writes).toEqual([])
    await expect(persistIntakeBlockOnLeave('children', { _children: [] }, { ...adapters, saveChildren: async () => { throw new Error('save failed') } })).rejects.toThrow('save failed')
  })

  it.each([
    ['client_fiduciaries', 'trustee', 'client'], ['client_fiduciaries', 'personal_rep', 'client'],
    ['client_fiduciaries', 'poa', 'client'], ['client_fiduciaries', 'hcp', 'client'],
    ['spouse_fiduciaries', 'personal_rep', 'spouse'], ['spouse_fiduciaries', 'poa', 'spouse'],
    ['spouse_fiduciaries', 'hcp', 'spouse'], ['college_agents', 'poa', 'client'],
    ['college_agents', 'hcp', 'client'], ['guardian', 'guardian', 'client'],
  ] as const)('persists explicit final nominee removal for %s/%s/%s and propagates a failed clear', async (id, role, party) => {
    const { writes, adapters } = context()
    const key = `_fid_${role}_${party}`
    const previous = { [key]: [{ first_name: 'Pat', last_name: 'Example', priority: 1 }] }
    const current = { [key]: [] }
    const snapshot = getIntakeBlockPersistenceSnapshot(id, previous)
    await persistIntakeBlockOnLeave(id, current, adapters, snapshot)
    expect(writes).toEqual([['fiduciaries', [], role, party]])
    await expect(persistIntakeBlockOnLeave(id, current, { ...adapters, saveFiduciaries: async () => { throw new Error('clear failed') } }, snapshot)).rejects.toThrow('clear failed')
  })

  it('does not rewrite untouched or absent fiduciary roles when another role changes', async () => {
    const { writes, adapters } = context()
    const previous = { _fid_poa_client: [{ first_name: 'Pat', priority: 1 }], _fid_hcp_client: [], _fid_trustee_client: [{ first_name: 'Lee', priority: 1 }] }
    await persistIntakeBlockOnLeave('client_fiduciaries', { ...previous, _fid_poa_client: [] }, adapters, getIntakeBlockPersistenceSnapshot('client_fiduciaries', previous))
    expect(writes).toEqual([['fiduciaries', [], 'poa', 'client']])
  })

  it('treats a present empty role as an explicit replacement when no saved baseline is supplied', async () => {
    const { writes, adapters } = context()
    await persistIntakeBlockOnLeave('college_agents', { _fid_poa_client: [] }, adapters)
    expect(writes).toEqual([['fiduciaries', [], 'poa', 'client']])
  })
})
