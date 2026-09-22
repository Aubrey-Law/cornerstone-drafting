import { describe, expect, it } from 'vitest'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { OPTIONAL_SERVICES } from '@/lib/engagement/definitions'
import { engagementSeedDefinition, engagementLegalPlanFrom } from '@/lib/engagement/seed'
import { ENGAGEMENT_TEMPLATES, engagementTemplateFor } from '@/lib/engagement/templates'
import { ENGAGEMENT_LEGAL_PLANS } from '@/lib/engagement/types'

/**
 * Which master an engagement renders from is now a choice rather than a
 * constant, and three places make it: the renderer, the drafting workspace, and
 * the routes that seed a draft. They all read `engagementTemplateFor`, and these
 * pin that — a definition the workspace will open has to be one a master covers,
 * or staff fill in a whole agreement and only find out at Generate.
 */

const couple = { matterId: 'matter-1', clientMode: 'couple', scopeKey: 'standard' }
const solo = { matterId: 'matter-1', clientMode: 'individual', scopeKey: 'standard' }

describe('engagement template selection', () => {
  it('sends a flat-fee estate-planning couple to the flat-fee master', () => {
    const template = engagementTemplateFor({ practiceArea: 'EP', clientMode: 'couple', scopeKey: 'standard', legalPlan: null })
    expect(template?.masterKey).toBe('ep-trust-couple')
    expect(template?.statesFirmFee).toBe(true)
  })

  it.each(ENGAGEMENT_LEGAL_PLANS)('sends an EP-LP couple on %s to the legal-plan master', plan => {
    const template = engagementTemplateFor({ practiceArea: 'EP-LP', clientMode: 'couple', scopeKey: 'standard', legalPlan: plan })
    expect(template?.masterKey).toBe('ep-lp-trust-couple')
    // The plan's schedule sets the fee, so the letter states none of its own.
    expect(template?.statesFirmFee).toBe(false)
    expect(template?.recipientCount).toBe(2)
  })

  it.each(ENGAGEMENT_LEGAL_PLANS)('sends a solo EP-LP client on %s to the solo master', plan => {
    const template = engagementTemplateFor({ practiceArea: 'EP-LP', clientMode: 'individual', scopeKey: 'standard', legalPlan: plan })
    expect(template?.masterKey).toBe('ep-lp-trust-individual')
    expect(template?.statesFirmFee).toBe(false)
    // One signer, so one signature and one date anchor.
    expect(template?.recipientCount).toBe(1)
  })

  it('offers credit shelter planning only where two exemptions exist to preserve', () => {
    const couple = engagementTemplateFor({ practiceArea: 'EP-LP', clientMode: 'couple', scopeKey: 'standard', legalPlan: 'metlife' })
    const solo = engagementTemplateFor({ practiceArea: 'EP-LP', clientMode: 'individual', scopeKey: 'standard', legalPlan: 'metlife' })
    expect(couple?.optionalServiceKeys).toEqual(['credit_shelter_planning', 'deed_recording'])
    expect(solo?.optionalServiceKeys).toEqual(['deed_recording'])
  })

  it('names a checkbox merge field for every service a master offers', () => {
    // A key with no entry here would render the literal string "undefined"
    // into the addendum the client signs.
    for (const template of ENGAGEMENT_TEMPLATES) {
      for (const key of template.optionalServiceKeys) {
        expect(OPTIONAL_SERVICES[key]?.checkboxTag, `${template.masterKey} offers ${key}`).toBeTruthy()
      }
    }
  })

  it.each([
    ['a plan on a flat-fee estate plan', { practiceArea: 'EP', legalPlan: 'metlife' }],
    ['no plan on a plan-funded estate plan', { practiceArea: 'EP-LP', legalPlan: null }],
    ['a plan with no name to print', { practiceArea: 'EP-LP', legalPlan: 'other_legal_plan' }],
    ['a solo flat-fee estate plan', { practiceArea: 'EP', clientMode: 'individual', legalPlan: null }],
    ['probate', { practiceArea: 'Probate', legalPlan: null }],
    ['a solo probate', { practiceArea: 'Probate', clientMode: 'individual', legalPlan: null }],
  ])('covers no master for %s', (_case, selector) => {
    expect(engagementTemplateFor({ clientMode: 'couple', scopeKey: 'standard', ...selector })).toBeNull()
  })

  it('opens the workspace on exactly the definitions a master covers', () => {
    expect(isSupportedWorkspaceDefinition({ ...couple, practiceArea: 'EP', legalPlan: null })).toBe(true)
    expect(isSupportedWorkspaceDefinition({ ...couple, practiceArea: 'EP-LP', legalPlan: 'metlife' })).toBe(true)
    expect(isSupportedWorkspaceDefinition({ ...solo, practiceArea: 'EP-LP', legalPlan: 'metlife' })).toBe(true)
    expect(isSupportedWorkspaceDefinition({ ...solo, practiceArea: 'EP', legalPlan: null })).toBe(false)
    expect(isSupportedWorkspaceDefinition({ ...couple, practiceArea: 'EP-LP', legalPlan: null })).toBe(false)
    // No owning record is still no workspace, whatever the definition says.
    expect(isSupportedWorkspaceDefinition({ practiceArea: 'EP', clientMode: 'couple', scopeKey: 'standard', legalPlan: null })).toBe(false)
  })

  it('offers every master for template override', () => {
    const registered = getDocumentTemplateRegistry().filter(entry => entry.category === 'engagement')
    expect(registered.map(entry => entry.id).sort())
      .toEqual(ENGAGEMENT_TEMPLATES.map(template => template.templateId).sort())
    for (const entry of registered) {
      expect(entry.renderer).toBe('engagement_docxtemplater')
    }
  })
})

describe('engagement draft seeding', () => {
  const spouse = { spouseEmail: 'jordan@example.com' }

  it('reads the plan from the record rather than asking for it again', () => {
    expect(engagementLegalPlanFrom('metlife')).toBe('metlife')
    expect(engagementLegalPlanFrom('MetLife')).toBe('metlife')
    expect(engagementLegalPlanFrom('flat_fee')).toBeNull()
    expect(engagementLegalPlanFrom('other_legal_plan')).toBeNull()
    expect(engagementLegalPlanFrom(null)).toBeNull()
  })

  it('seeds a flat-fee estate-planning couple with no plan', () => {
    const seed = engagementSeedDefinition({ practiceArea: 'EP', billingType: 'flat_fee', ...spouse })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'EP', clientMode: 'couple', scopeKey: 'standard', legalPlan: null },
      spouseEmail: 'jordan@example.com',
    })
  })

  it('seeds an LP couple with the plan the record is billed to', () => {
    const seed = engagementSeedDefinition({ practiceArea: 'Estate Planning - LP', billingType: 'legalease', ...spouse })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'EP-LP', clientMode: 'couple', scopeKey: 'standard', legalPlan: 'legalease' },
      spouseEmail: 'jordan@example.com',
    })
  })

  it('will not draft an LP letter before the plan is named', () => {
    // The letter names the plan in its coverage paragraph; guessing one would
    // put the wrong carrier in front of a client.
    const seed = engagementSeedDefinition({ practiceArea: 'EP-LP', billingType: null, ...spouse })
    expect(seed).toEqual({ ok: false, error: expect.stringMatching(/legal plan/i) })
  })

  it('seeds a solo LP client as an individual, with no spouse', () => {
    const seed = engagementSeedDefinition({ practiceArea: 'EP-LP', billingType: 'metlife', spouseEmail: null })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'EP-LP', clientMode: 'individual', scopeKey: 'standard', legalPlan: 'metlife' },
      spouseEmail: null,
    })
  })

  it('reads an empty spouse email as no spouse rather than a couple', () => {
    // A blank column is how a record with no spouse actually comes back, and a
    // couple seeded from one would have a signature line nobody can sign.
    const seed = engagementSeedDefinition({ practiceArea: 'EP-LP', billingType: 'arag', spouseEmail: '' })
    expect(seed).toMatchObject({ ok: true, definition: { clientMode: 'individual' }, spouseEmail: null })
  })

  it.each([
    ['a solo flat-fee client, whose letter has no solo master', { practiceArea: 'EP', billingType: 'flat_fee', spouseEmail: null }],
    ['a practice area with no master', { practiceArea: 'Probate', billingType: 'flat_fee', ...spouse }],
  ])('refuses %s', (_case, record) => {
    expect(engagementSeedDefinition(record).ok).toBe(false)
  })
})
