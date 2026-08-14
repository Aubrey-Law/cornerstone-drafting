import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getIntakeReadinessFlags,
  resolveIntakeReviewTarget,
  type IntakeReadinessFlag,
} from '@/lib/intakeReadiness'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'

function flag(key: string): IntakeReadinessFlag {
  return {
    key,
    label: key,
    message: key,
    sectionId: 'intake-only-id',
    severity: 'review',
    resolutionKind: 'needs_data',
  }
}

describe('intake review flag targets', () => {
  it.each([
    ['client_dob_missing', DESIGN_SECTION_IDS.clientInformation],
    ['spouse_dob_missing', DESIGN_SECTION_IDS.clientInformation],
    ['county_missing', DESIGN_SECTION_IDS.clientInformation],
    ['client_trustee_missing', DESIGN_SECTION_IDS.trustDetails],
    ['client_personal_rep_missing', DESIGN_SECTION_IDS.willDetails],
    ['spouse_personal_rep_missing', DESIGN_SECTION_IDS.willDetails],
    ['guardian_missing', DESIGN_SECTION_IDS.willDetails],
    ['client_poa_missing', DESIGN_SECTION_IDS.financialPoa],
    ['spouse_poa_missing', DESIGN_SECTION_IDS.financialPoa],
    ['client_hcp_missing', DESIGN_SECTION_IDS.healthcareDirectives],
    ['spouse_hcp_missing', DESIGN_SECTION_IDS.healthcareDirectives],
    ['real_estate_details_missing', DESIGN_SECTION_IDS.assetSchedules],
    ['bank_details_missing', DESIGN_SECTION_IDS.assetSchedules],
  ])('maps %s to a canonical drafting section', (key, sectionId) => {
    const target = resolveIntakeReviewTarget(flag(key))
    expect(target.sectionId).toBe(sectionId)
    expect(target.href('matter-1')).toContain('/admin/drafting/matter-1?step=design&focus=')
    expect(target.href('matter-1')).not.toContain('intake-only-id')
  })

  it('marks client-provided attorney choices separately from missing data', () => {
    const flags = getIntakeReadinessFlags({
      marital_status: 'single',
      date_of_birth: '1980-01-01',
      county: 'Middlesex',
      review_choices: { fiduciaries: 'discuss_with_attorney' },
    })

    expect(flags.find(item => item.key === 'client_trustee_missing')?.resolutionKind)
      .toBe('attorney_judgment')
    expect(flags.find(item => item.key === 'client_poa_missing')?.resolutionKind)
      .toBe('attorney_judgment')
  })
})

// Spouse, children, and fiduciaries live in `contacts` — client_intake.spouse_*
// and client_intake.fiduciary_entries were dropped. The readiness rules read the
// hydrated `_spouse` / `_fid_*` keys, so an unhydrated row flags data the
// attorney did enter.
describe('contacts-backed readiness flags', () => {
  const married = {
    marital_status: 'married',
    date_of_birth: '1980-01-01',
    county: 'Middlesex',
  }

  it('clears the spouse date-of-birth flag from the hydrated spouse contact', () => {
    const hydrated = getIntakeReadinessFlags({
      ...married,
      _spouse: { first_name: 'John', last_name: 'Example', date_of_birth: '1979-02-02' },
    })
    expect(hydrated.some(item => item.key === 'spouse_dob_missing')).toBe(false)

    const unhydrated = getIntakeReadinessFlags(married)
    expect(unhydrated.some(item => item.key === 'spouse_dob_missing')).toBe(true)
  })

  it('clears fiduciary flags from hydrated contact entries', () => {
    const flags = getIntakeReadinessFlags({
      ...married,
      _fid_trustee_client: [{ first_name: 'Taylor', last_name: 'Trustee' }],
      _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Executor' }],
    })

    expect(flags.some(item => item.key === 'client_trustee_missing')).toBe(false)
    expect(flags.some(item => item.key === 'client_personal_rep_missing')).toBe(false)
    expect(flags.some(item => item.key === 'client_poa_missing')).toBe(true)
  })
})

// Every reader of a raw client_intake row must hydrate before it evaluates or
// forwards spouse / children / fiduciary data, since those columns were dropped.
describe('raw client_intake readers hydrate contacts', () => {
  const CALLERS: Array<[file: string, hydrator: string]> = [
    ['app/actions/adminIntake.ts', 'hydrateIntakeWithContacts'],
    ['lib/calendarAttention.ts', 'applyContactIntakeData'],
    ['app/api/admin/works/runs/route.ts', 'hydrateIntakeWithContacts'],
    ['app/api/intake/route.ts', 'hydrateIntakeWithContacts'],
    ['lib/adminChat/engine.ts', 'loadSpouseContact'],
  ]

  it.each(CALLERS)('%s hydrates via %s', (file, hydrator) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(source).toContain("select('*')")
    expect(source).toContain(hydrator)
  })

  it('reads intake contacts in one batch on the calendar attention path', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/calendarAttention.ts'), 'utf8')
    // Per-appointment hydration would issue a query per row in the loop. Since
    // step 3 of docs/matter-contacts-migration.md the batch is keyed on the
    // matters this loop already holds, not on their households.
    expect(source).toContain('loadMatterContactsForMatters(admin, [...intakeIdByMatter.keys()]')
    expect(source).toContain('contactsByIntake.get(row.id) ?? []')
  })
})

describe('admin intake review flag computation', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/actions/adminIntake.ts'), 'utf8')

  it('hydrates the intake row with contacts before computing flags', () => {
    expect(source).toContain('async function recomputeIntakeReviewFlags(')
    expect(source).toContain('hydrated = await hydrateIntakeWithContacts(admin, intakeRow, intakeId)')
    expect(source).toContain('getIntakeReadinessFlags(hydrated as IntakeRow)')
  })

  it('routes every flag computation through the hydrating helper', () => {
    const directCalls = source.match(/getIntakeReadinessFlags\(/g) ?? []
    expect(directCalls).toHaveLength(1)
    expect(source).not.toContain('getIntakeReadinessFlags(intakeRow as IntakeRow)')
    expect((source.match(/recomputeIntakeReviewFlags\(admin, intakeId\)/g) ?? []).length).toBe(2)
  })
})
