import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveDraftComposition } from '@/lib/matter/matterType'

/**
 * Whether a plan is drafted for one person or two is the one thing the payload
 * refuses to guess: drafting a couple's plan as an individual's, or the
 * reverse, is silent and wrong. The exception is a plan that can only ever have
 * one client, where the confirmation has a single possible answer.
 */

describe('resolveDraftComposition', () => {
  it('refuses to guess an unconfirmed matter type', () => {
    expect(() => resolveDraftComposition(null, false)).toThrow(
      'Matter type must be confirmed before drafting',
    )
    expect(() => resolveDraftComposition('', false)).toThrow()
    expect(() => resolveDraftComposition('household', false)).toThrow()
  })

  it('splits a couple by whether the trust is joint', () => {
    expect(resolveDraftComposition('couple', true)).toBe('married_joint')
    expect(resolveDraftComposition('couple', false)).toBe('married_individual')
    expect(resolveDraftComposition('individual', true)).toBe('individual')
  })

  it('drafts a single-client plan without a confirmed matter type', () => {
    // The College Preparation Plan: one student, parents as contacts and
    // nominees rather than co-clients. Nobody has a one-or-two decision to make,
    // so blocking the draft on one only stops work.
    expect(resolveDraftComposition(null, false, { singleClientPlan: true })).toBe('individual')
  })

  it('holds one client even against a stale couple', () => {
    // A matter reclassified out of estate planning can still be carrying
    // `couple`. Honouring it would put spouse documents into a student's plan.
    expect(resolveDraftComposition('couple', true, { singleClientPlan: true })).toBe('individual')
  })
})

describe('the draft payload', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/assemble.ts'), 'utf8')

  it('treats a college-prep sheet as the single-client plan it is', () => {
    expect(source).toContain('singleClientPlan: isCollegePrepDesignSheet(designSheet)')
  })

  it('derives the participant type from the resolved composition', () => {
    // Reading the raw column here instead would reintroduce the stale-couple
    // case the resolver just ruled out.
    expect(source).toContain("const participantType = isCouple ? 'couple' : 'individual'")
    expect(source).not.toContain("matter.matter_type === 'couple' ? 'couple' : 'individual'")
  })
})
