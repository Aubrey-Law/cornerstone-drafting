import { describe, expect, it } from 'vitest'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { OPTIONAL_SERVICES } from '@/lib/engagement/definitions'
import { engagementSeedDefinition, engagementLegalPlanFrom } from '@/lib/engagement/seed'
import { ENGAGEMENT_TEMPLATES, PROBATE_PHASE_SHARES, engagementTemplateFor } from '@/lib/engagement/templates'
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
    expect(template?.firmFee).toBe('amount_and_terms')
  })

  it('sends a solo flat-fee client to the solo flat-fee master', () => {
    const template = engagementTemplateFor({ practiceArea: 'EP', clientMode: 'individual', scopeKey: 'standard', legalPlan: null })
    expect(template?.masterKey).toBe('ep-trust-individual')
    // No plan pays this one, so the agreement states the firm's own fee.
    expect(template?.firmFee).toBe('amount_and_terms')
    expect(template?.recipientCount).toBe(1)
  })

  it.each(ENGAGEMENT_LEGAL_PLANS)('sends an EP-LP couple on %s to the legal-plan master', plan => {
    const template = engagementTemplateFor({ practiceArea: 'EP-LP', clientMode: 'couple', scopeKey: 'standard', legalPlan: plan })
    expect(template?.masterKey).toBe('ep-lp-trust-couple')
    // The plan's schedule sets the fee, so the letter states none of its own.
    expect(template?.firmFee).toBe('none')
    expect(template?.recipientCount).toBe(2)
  })

  it.each(ENGAGEMENT_LEGAL_PLANS)('sends a solo EP-LP client on %s to the solo master', plan => {
    const template = engagementTemplateFor({ practiceArea: 'EP-LP', clientMode: 'individual', scopeKey: 'standard', legalPlan: plan })
    expect(template?.masterKey).toBe('ep-lp-trust-individual')
    expect(template?.firmFee).toBe('none')
    // One signer, so one signature and one date anchor.
    expect(template?.recipientCount).toBe(1)
  })

  it('sends a probate matter to the probate master, which states a fee but no terms', () => {
    const template = engagementTemplateFor({ practiceArea: 'Probate', clientMode: 'individual', scopeKey: 'standard', legalPlan: null })
    expect(template?.masterKey).toBe('probate-individual')
    expect(template?.recipientCount).toBe(1)
    // It prints its own phase schedule, so there are no free-text terms to ask for.
    expect(template?.firmFee).toBe('amount')
    expect(template?.namesDecedent).toBe(true)
    // Its terms are its own numbered sections; there is no Schedule A.
    expect(template?.printsScheduleAClauses).toBe(false)
  })

  it('names a decedent on exactly the master that prints an estate', () => {
    for (const template of ENGAGEMENT_TEMPLATES) {
      expect(Boolean(template.namesDecedent), template.masterKey).toBe(template.practiceArea === 'Probate')
    }
  })

  it('divides a probate fee into phases that add back up to it', () => {
    const shares = Object.values(PROBATE_PHASE_SHARES)
    expect(shares.reduce((total, share) => total + share, 0)).toBe(1)
    expect(PROBATE_PHASE_SHARES.opening).toBe(0.5)
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
    // Probate is the personal representative alone; there is no couple master.
    ['a probate couple', { practiceArea: 'Probate', legalPlan: null }],
    ['a probate on a legal plan', { practiceArea: 'Probate', clientMode: 'individual', legalPlan: 'metlife' }],
  ])('covers no master for %s', (_case, selector) => {
    expect(engagementTemplateFor({ clientMode: 'couple', scopeKey: 'standard', ...selector })).toBeNull()
  })

  it('opens the workspace on exactly the definitions a master covers', () => {
    expect(isSupportedWorkspaceDefinition({ ...couple, practiceArea: 'EP', legalPlan: null })).toBe(true)
    expect(isSupportedWorkspaceDefinition({ ...couple, practiceArea: 'EP-LP', legalPlan: 'metlife' })).toBe(true)
    expect(isSupportedWorkspaceDefinition({ ...solo, practiceArea: 'EP-LP', legalPlan: 'metlife' })).toBe(true)
    expect(isSupportedWorkspaceDefinition({ ...solo, practiceArea: 'EP', legalPlan: null })).toBe(true)
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
      decedentName: null,
    })
  })

  it('seeds an LP couple with the plan the record is billed to', () => {
    const seed = engagementSeedDefinition({ practiceArea: 'Estate Planning - LP', billingType: 'legalease', ...spouse })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'EP-LP', clientMode: 'couple', scopeKey: 'standard', legalPlan: 'legalease' },
      spouseEmail: 'jordan@example.com',
      decedentName: null,
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
      decedentName: null,
    })
  })

  it('reads an empty spouse email as no spouse rather than a couple', () => {
    // A blank column is how a record with no spouse actually comes back, and a
    // couple seeded from one would have a signature line nobody can sign.
    const seed = engagementSeedDefinition({ practiceArea: 'EP-LP', billingType: 'arag', spouseEmail: '' })
    expect(seed).toMatchObject({ ok: true, definition: { clientMode: 'individual' }, spouseEmail: null })
  })

  it('seeds a solo flat-fee client from a record with no spouse', () => {
    const seed = engagementSeedDefinition({ practiceArea: 'EP', billingType: 'flat_fee', spouseEmail: null })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'EP', clientMode: 'individual', scopeKey: 'standard', legalPlan: null },
      spouseEmail: null,
      decedentName: null,
    })
  })

  it('seeds a probate matter as the personal representative alone', () => {
    // A surviving spouse is common on a probate record and is not a second
    // signer: the personal representative engages the firm by themselves.
    const seed = engagementSeedDefinition({
      practiceArea: 'Probate', billingType: 'flat_fee', decedentName: 'Rosemary Decedent', ...spouse,
    })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'Probate', clientMode: 'individual', scopeKey: 'standard', legalPlan: null },
      spouseEmail: null,
      decedentName: 'Rosemary Decedent',
    })
  })

  it('will not draft a probate agreement before the estate is named', () => {
    const seed = engagementSeedDefinition({ practiceArea: 'Probate', billingType: 'flat_fee', spouseEmail: null, decedentName: '  ' })
    expect(seed).toEqual({ ok: false, error: expect.stringMatching(/decedent/i) })
  })

  it('carries no decedent on an agreement that names none', () => {
    expect(engagementSeedDefinition({ practiceArea: 'EP', billingType: 'flat_fee', decedentName: 'Someone', ...spouse }))
      .toMatchObject({ ok: true, decedentName: null })
  })

  it('keeps a couple who share one email a couple, with the spouse email left for staff', () => {
    // Each signer is a separate e-signature recipient keyed by email; seeding
    // the shared address twice made the draft fail on the recipients insert.
    const seed = engagementSeedDefinition({
      practiceArea: 'EP-LP', billingType: 'metlife', spouseEmail: 'Family@Example.com', primaryEmail: 'family@example.com',
    })
    expect(seed).toEqual({
      ok: true,
      definition: { practiceArea: 'EP-LP', clientMode: 'couple', scopeKey: 'standard', legalPlan: 'metlife' },
      spouseEmail: '',
      decedentName: null,
    })
  })

  it('refuses a practice area with no master', () => {
    expect(engagementSeedDefinition({ practiceArea: 'CP', billingType: 'flat_fee', ...spouse }).ok).toBe(false)
  })
})
