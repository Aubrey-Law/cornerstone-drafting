import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'
import { getIntegrationSettings, sanitizeDocIdMap } from '@/lib/integrations/settings'
import {
  packageKey,
  resolveStatularDocId,
  resolveStatularPackageKey,
} from '@/lib/integrations/statular/packageKey'

const mocks = vi.hoisted(() => ({
  matter: { id: 'matter-1', client_intake_id: 'intake-1', matter_type: 'individual' } as Record<string, unknown> | null,
  details: { client_id: 'matter-1', practice_area: 'EP' } as Record<string, unknown> | null,
  designs: [] as Array<Record<string, unknown>>,
  intake: { id: 'intake-1', plan_type: null, intake_track: 'estate', practice_area: 'EP' } as Record<string, unknown> | null,
  settings: { id: 1, statular_doc_id_map: {} } as Record<string, unknown> | null,
  errors: {} as Record<string, unknown>,
  rejections: {} as Record<string, unknown>,
  reads: [] as Array<{
    table: string
    select: string | undefined
    eqs: Array<[string, unknown]>
    orders: Array<[string, { ascending?: boolean }]>
    limit: number | null
  }>,
  mutations: [] as Array<{ method: string; table: string }>,
  buildDraftPayload: vi.fn(),
  seedDesignSheet: vi.fn(),
}))

vi.mock('@/lib/draftPayload/assemble', () => ({ buildDraftPayload: mocks.buildDraftPayload }))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({
  ensureDesignSheetSeededFromIntake: mocks.seedDesignSheet,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      let select: string | undefined
      const eqs: Array<[string, unknown]> = []
      const orders: Array<[string, { ascending?: boolean }]> = []
      let limit: number | null = null
      const builder = {
        select(value: string) { select = value; return builder },
        eq(column: string, value: unknown) { eqs.push([column, value]); return builder },
        order(column: string, options: { ascending?: boolean }) { orders.push([column, options]); return builder },
        limit(value: number) { limit = value; return builder },
        insert() { mocks.mutations.push({ method: 'insert', table }); return builder },
        update() { mocks.mutations.push({ method: 'update', table }); return builder },
        upsert() { mocks.mutations.push({ method: 'upsert', table }); return builder },
        async maybeSingle() {
          mocks.reads.push({ table, select, eqs, orders, limit })
          if (table in mocks.rejections) throw mocks.rejections[table]
          const error = mocks.errors[table] ?? null
          if (error) return { data: null, error }
          const matches = (row: Record<string, unknown>) => eqs.every(([column, value]) => row[column] === value)
          const identified = (row: Record<string, unknown> | null, identity: Record<string, unknown>) =>
            row ? { ...identity, ...row } : null
          const matter = identified(mocks.matter, { id: 'matter-1' })
          const details = identified(mocks.details, { client_id: 'matter-1' })
          const intake = identified(mocks.intake, { id: 'intake-1' })
          const settings = identified(mocks.settings, { id: 1 })
          if (table === 'matters') return { data: matter && matches(matter) ? matter : null, error: null }
          if (table === 'matter_details') return { data: details && matches(details) ? details : null, error: null }
          if (table === 'client_intake') return { data: intake && matches(intake) ? intake : null, error: null }
          if (table === 'integration_settings') return { data: settings && matches(settings) ? settings : null, error: null }
          if (table === 'design_sheets') {
            let rows = mocks.designs.filter(matches)
            for (const [column, options] of [...orders].reverse()) {
              rows = [...rows].sort((a, b) => {
                const comparison = Number(a[column]) - Number(b[column])
                return options.ascending === false ? -comparison : comparison
              })
            }
            if (limit !== null) rows = rows.slice(0, limit)
            if (rows.length > 1) return { data: null, error: { message: 'Multiple rows returned.' } }
            return { data: rows[0] ?? null, error: null }
          }
          throw new Error(`Unexpected table ${table}`)
        },
      }
      return builder
    },
  }),
}))

function design(planType: unknown, isJoint: unknown = null, decisions: unknown = {}) {
  mocks.designs = [{ matter_id: 'matter-1', plan_type: planType, is_joint: isJoint, decisions, version: 3 }]
}

function expectConfigurationRequired(error: unknown) {
  expect(error).toBeInstanceOf(IntegrationError)
  expect(error).toMatchObject({
    provider: 'statular',
    kind: 'attention',
    code: 'configuration_required',
    safeMessage: 'The Statular document package needs configuration.',
  })
  expect(JSON.stringify(error)).not.toMatch(/RAW|SECRET/)
}

async function assertConfigurationRequired(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error('Expected configuration-required rejection.')
  } catch (error) {
    expectConfigurationRequired(error)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.matter = { id: 'matter-1', client_intake_id: 'intake-1', matter_type: 'individual' }
  mocks.details = { client_id: 'matter-1', practice_area: 'EP' }
  mocks.designs = []
  mocks.intake = { id: 'intake-1', plan_type: null, intake_track: 'estate', practice_area: 'EP' }
  mocks.settings = { id: 1, statular_doc_id_map: {} }
  mocks.errors = {}
  mocks.rejections = {}
  mocks.reads = []
  mocks.mutations = []
})

describe('Statular package key vocabulary', () => {
  const estatePlanKeys = [
    'individual_trust',
    'joint_trust',
    'separate_trust',
    'will_individual',
    'will_couple',
    'testamentary_trust_individual',
    'testamentary_trust_couple',
    'incapacity_individual',
    'incapacity_couple',
  ] as const

  it.each(['EP', 'EP-LP'] as const)('preserves every supported %s package mapping losslessly', practiceArea => {
    for (const normalizedPlanType of estatePlanKeys) {
      const expected = `${practiceArea}:${normalizedPlanType}`
      expect(packageKey({ practiceArea, normalizedPlanType })).toBe(expected)
      expect(sanitizeDocIdMap({ [expected]: 4 })).toEqual({ [expected]: 4 })
    }
  })

  it('preserves the explicit College Prep package key', () => {
    expect(packageKey({ practiceArea: 'CP', normalizedPlanType: 'college_prep' }))
      .toBe('CP:college_prep')
    expect(sanitizeDocIdMap({ 'CP:college_prep': 4 })).toEqual({ 'CP:college_prep': 4 })
  })

  it.each([
    'ep:joint_trust',
    'EP:Joint_Trust',
    ' EP:joint_trust',
    'EP:joint_trust ',
    'EP:joint-trust',
    'Probate:probate',
    'CP:estate',
    'EP:college_prep',
    '__proto__',
    'constructor',
    'prototype',
  ])('rejects malformed configuration key %s without guessing', key => {
    expect(() => sanitizeDocIdMap({ [key]: 4 })).toThrow(/package key|stable keys/)
  })

  it.each([0, -1, 1.2, '4', Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe Statular document ID %s',
    value => expect(() => sanitizeDocIdMap({ 'EP:joint_trust': value })).toThrow('positive integer'),
  )

  it('retains plain-object and prototype defenses', () => {
    class UnsafeMap { ['EP:joint_trust'] = 4 }
    const poisoned = Object.create(null) as Record<string, unknown>
    poisoned.__proto__ = 4
    expect(() => sanitizeDocIdMap(new UnsafeMap())).toThrow('object')
    expect(() => sanitizeDocIdMap(poisoned)).toThrow(/package key|stable keys/)
    expect(Object.getPrototypeOf(sanitizeDocIdMap({ 'EP:joint_trust': 4 }))).toBe(Object.prototype)
  })
})

describe('resolveStatularPackageKey', () => {
  it.each([
    { practice: 'EP', matterType: 'individual', plan: 'pour_over', joint: null, want: 'EP:individual_trust' },
    { practice: 'EP', matterType: 'couple', plan: 'pour_over', joint: true, want: 'EP:joint_trust' },
    { practice: 'EP', matterType: 'couple', plan: 'pour_over', joint: false, want: 'EP:separate_trust' },
    { practice: 'EP', matterType: 'individual', plan: 'outright_will', joint: null, want: 'EP:will_individual' },
    { practice: 'EP', matterType: 'couple', plan: 'outright_will', joint: null, want: 'EP:will_couple' },
    { practice: 'EP', matterType: 'individual', plan: 'testamentary_trust', joint: null, want: 'EP:testamentary_trust_individual' },
    { practice: 'EP', matterType: 'couple', plan: 'testamentary_trust', joint: null, want: 'EP:testamentary_trust_couple' },
    { practice: 'EP-LP', matterType: 'individual', plan: 'pour_over', joint: null, want: 'EP-LP:individual_trust' },
    { practice: 'EP-LP', matterType: 'couple', plan: 'pour_over', joint: true, want: 'EP-LP:joint_trust' },
    { practice: 'EP-LP', matterType: 'couple', plan: 'pour_over', joint: false, want: 'EP-LP:separate_trust' },
    { practice: 'EP-LP', matterType: 'individual', plan: 'outright_will', joint: null, want: 'EP-LP:will_individual' },
    { practice: 'EP-LP', matterType: 'couple', plan: 'outright_will', joint: null, want: 'EP-LP:will_couple' },
    { practice: 'EP-LP', matterType: 'individual', plan: 'testamentary_trust', joint: null, want: 'EP-LP:testamentary_trust_individual' },
    { practice: 'EP-LP', matterType: 'couple', plan: 'testamentary_trust', joint: null, want: 'EP-LP:testamentary_trust_couple' },
  ])('maps latest design evidence to $want', async ({ practice, matterType, plan, joint, want }) => {
    mocks.details = { practice_area: practice }
    mocks.matter = { client_intake_id: 'intake-1', matter_type: matterType }
    design(plan, joint)
    expect(await resolveStatularPackageKey('matter-1')).toBe(want)
    expect(mocks.reads.find(read => read.table === 'design_sheets')?.orders)
      .toContainEqual(['version', { ascending: false }])
  })

  it.each([
    { practice: 'EP', matterType: 'couple', intakePlan: 'joint_rlt', want: 'EP:joint_trust' },
    { practice: 'EP', matterType: 'couple', intakePlan: 'separate_rlt', want: 'EP:separate_trust' },
    { practice: 'EP', matterType: 'individual', intakePlan: 'individual_rlt', want: 'EP:individual_trust' },
    { practice: 'EP', matterType: 'individual', intakePlan: 'will_based', want: 'EP:will_individual' },
    { practice: 'EP', matterType: 'couple', intakePlan: 'will_based', want: 'EP:will_couple' },
    { practice: 'EP', matterType: 'individual', intakePlan: 'incapacity_only', want: 'EP:incapacity_individual' },
    { practice: 'EP', matterType: 'couple', intakePlan: 'incapacity_only', want: 'EP:incapacity_couple' },
    { practice: 'EP-LP', matterType: 'couple', intakePlan: 'joint_rlt', want: 'EP-LP:joint_trust' },
    { practice: 'EP-LP', matterType: 'couple', intakePlan: 'separate_rlt', want: 'EP-LP:separate_trust' },
    { practice: 'EP-LP', matterType: 'individual', intakePlan: 'individual_rlt', want: 'EP-LP:individual_trust' },
    { practice: 'EP-LP', matterType: 'individual', intakePlan: 'will_based', want: 'EP-LP:will_individual' },
    { practice: 'EP-LP', matterType: 'couple', intakePlan: 'will_based', want: 'EP-LP:will_couple' },
    { practice: 'EP-LP', matterType: 'individual', intakePlan: 'incapacity_only', want: 'EP-LP:incapacity_individual' },
    { practice: 'EP-LP', matterType: 'couple', intakePlan: 'incapacity_only', want: 'EP-LP:incapacity_couple' },
  ])('uses the canonical intake fallback for $want', async ({ practice, matterType, intakePlan, want }) => {
    mocks.details = { practice_area: practice }
    mocks.matter = { client_intake_id: 'intake-1', matter_type: matterType }
    mocks.intake = { practice_area: practice, intake_track: 'estate', plan_type: intakePlan }
    expect(await resolveStatularPackageKey('matter-1')).toBe(want)
  })

  it('uses only the latest design and lets valid design evidence outrank intake', async () => {
    mocks.matter = { id: 'matter-1', client_intake_id: 'intake-1', matter_type: 'couple' }
    mocks.designs = [
      { matter_id: 'other-matter', version: 99, plan_type: 'pour_over', is_joint: true, decisions: {} },
      { matter_id: 'matter-1', version: 6, plan_type: 'pour_over', is_joint: true, decisions: {} },
      { matter_id: 'matter-1', version: 7, plan_type: 'outright_will', is_joint: false, decisions: {} },
    ]
    mocks.intake = { practice_area: 'EP', intake_track: 'estate', plan_type: 'joint_rlt' }
    expect(await resolveStatularPackageKey('matter-1')).toBe('EP:will_couple')
  })

  it('falls back to intake practice area only when the primary value is genuinely absent', async () => {
    mocks.details = { practice_area: '  ' }
    mocks.intake = { practice_area: 'EP-LP', intake_track: 'estate', plan_type: 'individual_rlt' }
    expect(await resolveStatularPackageKey('matter-1')).toBe('EP-LP:individual_trust')
  })

  it.each([
    () => { mocks.details = { practice_area: 'private-invalid-area' }; mocks.intake = { practice_area: 'EP', plan_type: 'individual_rlt', intake_track: 'estate' } },
    () => { design('private-invalid-plan'); mocks.intake = { practice_area: 'EP', plan_type: 'individual_rlt', intake_track: 'estate' } },
    () => { mocks.details = { practice_area: null }; mocks.intake = { practice_area: 'private-invalid-area', plan_type: 'individual_rlt', intake_track: 'estate' } },
    () => { mocks.intake = { practice_area: 'EP', plan_type: 'private-invalid-plan', intake_track: 'estate' } },
  ])('rejects invalid nonblank primary evidence without silently falling back %#', async arrange => {
    arrange()
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it.each([
    { matterType: 'individual', plan: 'pour_over', joint: true, intakePlan: 'individual_rlt' },
    { matterType: 'couple', plan: 'pour_over', joint: null, intakePlan: 'joint_rlt' },
  ])('rejects contradictory or incomplete design composition %#', async row => {
    mocks.matter = { client_intake_id: 'intake-1', matter_type: row.matterType }
    design(row.plan, row.joint)
    mocks.intake = { practice_area: 'EP', plan_type: row.intakePlan, intake_track: 'estate' }
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it.each([
    ['individual', 'joint_rlt'],
    ['individual', 'separate_rlt'],
    ['couple', 'individual_rlt'],
  ])('rejects intake composition %s + %s', async (matterType, planType) => {
    mocks.matter = { client_intake_id: 'intake-1', matter_type: matterType }
    mocks.intake = { practice_area: 'EP', plan_type: planType, intake_track: 'estate' }
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it.each([null, '', 'joint', 'SINGLE'])('requires canonical confirmed matter type %s', async matterType => {
    mocks.matter = { client_intake_id: 'intake-1', matter_type: matterType }
    mocks.intake = { practice_area: 'EP', plan_type: 'will_based', intake_track: 'estate' }
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it.each([
    { decisions: { plan_track: 'college_prep' }, intakeTrack: 'estate' },
    { decisions: {}, intakeTrack: 'college_prep' },
  ])('requires an explicit normalized College Prep track %#', async ({ decisions, intakeTrack }) => {
    mocks.details = { practice_area: 'CP' }
    mocks.matter = { client_intake_id: 'intake-1', matter_type: null }
    design(null, null, decisions)
    mocks.intake = { practice_area: 'CP', plan_type: null, intake_track: intakeTrack }
    expect(await resolveStatularPackageKey('matter-1')).toBe('CP:college_prep')
  })

  it.each([undefined, null, '', 'estate', 'COLLEGE_PREP'])('rejects missing or guessed CP track %s', async track => {
    mocks.details = { practice_area: 'CP' }
    mocks.intake = { practice_area: 'CP', plan_type: null, intake_track: track }
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it('keeps Probate unavailable until a strict package vocabulary exists', async () => {
    mocks.details = { practice_area: 'Probate' }
    design(null, null, { plan_track: 'informal_probate' })
    mocks.intake = { practice_area: 'Probate', plan_type: 'free text probate', intake_track: 'estate' }
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it('returns null only when the matter does not exist', async () => {
    mocks.matter = null
    await expect(resolveStatularPackageKey('missing-matter')).resolves.toBeNull()
  })

  it('reports missing package evidence for an existing matter as attention', async () => {
    await assertConfigurationRequired(resolveStatularPackageKey('matter-1'))
  })

  it.each(['matters', 'matter_details', 'design_sheets', 'client_intake'])(
    'normalizes %s read failures to a safe retryable persistence error',
    async table => {
      mocks.errors[table] = { message: 'RAW_DATABASE_SECRET' }
      await expect(resolveStatularPackageKey('matter-1')).rejects.toMatchObject({
        provider: 'statular', kind: 'retryable', code: 'integration_persistence_failed',
        safeMessage: 'Unable to read Statular package configuration.',
      })
      await resolveStatularPackageKey('matter-1').catch(error => {
        expect(JSON.stringify(error)).not.toMatch(/RAW_DATABASE_SECRET/)
      })
    },
  )

  it('is read-only and never calls drafting payload or seed helpers', async () => {
    design('pour_over', false)
    await expect(resolveStatularPackageKey('matter-1')).resolves.toBe('EP:individual_trust')
    expect(mocks.mutations).toEqual([])
    expect(mocks.buildDraftPayload).not.toHaveBeenCalled()
    expect(mocks.seedDesignSheet).not.toHaveBeenCalled()
    expect(mocks.reads.map(read => [read.table, read.select])).toEqual([
      ['matters', 'client_intake_id,matter_type'],
      ['matter_details', 'practice_area'],
      ['design_sheets', 'plan_type,is_joint,decisions'],
      ['client_intake', 'plan_type,intake_track,practice_area'],
    ])
    expect(mocks.reads.map(read => [read.table, read.eqs, read.orders, read.limit])).toEqual([
      ['matters', [['id', 'matter-1']], [], null],
      ['matter_details', [['client_id', 'matter-1']], [], null],
      ['design_sheets', [['matter_id', 'matter-1']], [['version', { ascending: false }]], 1],
      ['client_intake', [['id', 'intake-1']], [], null],
    ])
  })
})

describe('resolveStatularDocId', () => {
  it('uses only the exact validated package key', async () => {
    design('pour_over', false)
    mocks.settings = {
      statular_doc_id_map: {
        'ep:individual_trust': 8,
        'EP:individual_trust': 42,
      },
    }
    // The malformed near-match is ignored, never case-folded or allowed to
    // hide the independently valid exact mapping.
    await expect(resolveStatularDocId('matter-1')).resolves.toBe(42)
  })

  it('isolates a legacy Statular key so shared Lawmatics settings remain readable', async () => {
    mocks.settings = {
      id: 1,
      lawmatics_appointment_sync_enabled: true,
      lawmatics_event_type_id_map: { consultation: 'lawmatics-event-1' },
      lawmatics_location_id_map: {},
      lawmatics_user_ids: ['lawmatics-user-1'],
      lawmatics_last_checked_at: null,
      lawmatics_last_check_error: null,
      statular_sync_enabled: false,
      statular_doc_id_map: { 'EP:individual_rlt': 41 },
      statular_drafter_id: null,
    }
    await expect(getIntegrationSettings()).resolves.toMatchObject({
      lawmaticsAppointmentSyncEnabled: true,
      lawmaticsEventTypeIdMap: { consultation: 'lawmatics-event-1' },
      lawmaticsUserIds: ['lawmatics-user-1'],
      statularSyncEnabled: false,
      statularDocIdMap: {},
    })

    design('pour_over', false)
    await assertConfigurationRequired(resolveStatularDocId('matter-1'))
  })

  it('reports an absent exact mapping as configuration attention', async () => {
    design('pour_over', false)
    mocks.settings = { statular_doc_id_map: { 'EP-LP:individual_trust': 42 } }
    await assertConfigurationRequired(resolveStatularDocId('matter-1'))
  })

  it('does not read settings when the matter does not exist', async () => {
    mocks.matter = null
    await assertConfigurationRequired(resolveStatularDocId('missing-matter'))
    expect(mocks.reads.some(read => read.table === 'integration_settings')).toBe(false)
  })

  it('normalizes settings read failures without exposing database details', async () => {
    design('pour_over', false)
    mocks.errors.integration_settings = { message: 'RAW_SETTINGS_SECRET' }
    await expect(resolveStatularDocId('matter-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'retryable', code: 'integration_persistence_failed',
      safeMessage: 'Unable to read Statular package configuration.',
    })
    await resolveStatularDocId('matter-1').catch(error => {
      expect(JSON.stringify(error)).not.toMatch(/RAW_SETTINGS_SECRET/)
    })
  })

  it('normalizes an unexpected rejected settings read as safe retryable persistence failure', async () => {
    design('pour_over', false)
    mocks.rejections.integration_settings = new Error('RAW_SETTINGS_RUNTIME_SECRET')
    await expect(resolveStatularDocId('matter-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'retryable', code: 'integration_persistence_failed',
      safeMessage: 'Unable to read Statular package configuration.',
    })
    await resolveStatularDocId('matter-1').catch(error => {
      expect(JSON.stringify(error)).not.toMatch(/RAW_SETTINGS_RUNTIME_SECRET/)
    })
  })
})
