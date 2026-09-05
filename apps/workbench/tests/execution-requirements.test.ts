import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_KINDS,
  ceremonyPlan,
  documentLabel,
  requirementsFor,
} from '@/lib/execution/requirements'

/**
 * These are Massachusetts execution rules as the firm has encoded them, and
 * every one carries its citation so it can be checked rather than believed.
 * The tests are written the same way: each names the consequence of getting it
 * wrong, because that is what makes a rule worth a line of code.
 */
describe('every document kind', () => {
  it.each([...DOCUMENT_KINDS])('%s states its authority', (kind) => {
    const requirement = requirementsFor(kind)
    // A checklist an attorney cannot verify is a checklist they must trust.
    expect(requirement.citation.length).toBeGreaterThan(5)
    expect(requirement.signers.length).toBeGreaterThan(0)
    expect(documentLabel(kind).length).toBeGreaterThan(2)
  })
})

describe('a will', () => {
  const will = requirementsFor('will')

  it('needs two witnesses', () => {
    expect(will.witnesses).toBe(2)
    expect(will.citation).toContain('2-502')
  })

  /**
   * The confusion this exists to prevent: a notary does not make a will valid
   * in Massachusetts, and a notarised will with one witness is not a will. The
   * notary is for the self-proving affidavit, which saves hunting down a
   * witness years later.
   */
  it('does not require a notary for validity, only for the self-proving affidavit', () => {
    expect(will.notary).toBe('recommended')
    expect(will.selfProving).toBe(true)
    expect(will.notes.join(' ')).toMatch(/not required for the will to be valid/i)
  })

  it('is signed by the testator', () => {
    expect(will.signers).toContain('Testator')
  })
})

describe('a health care proxy', () => {
  const proxy = requirementsFor('health_care_proxy')

  it('needs two adult witnesses and no notary', () => {
    expect(proxy.witnesses).toBe(2)
    expect(proxy.notary).toBe('not_required')
    expect(proxy.citation).toContain('201D')
  })

  /**
   * The statutory disqualification, and the classic error: the person being
   * appointed cannot witness their own appointment. It is the one rule here
   * that invalidates the document rather than merely complicating it.
   */
  it('bars the health care agent from witnessing', () => {
    expect(proxy.disqualifiedWitnesses.join(' ')).toMatch(/agent/i)
  })
})

describe('a deed', () => {
  const deed = requirementsFor('deed')

  it('must be notarised, and needs no witnesses', () => {
    expect(deed.notary).toBe('required')
    expect(deed.witnesses).toBe(0)
    expect(deed.citation).toContain('183')
  })

  /**
   * Signed is not funded. An unrecorded deed leaves the property exposed to
   * later creditors and purchasers, which is the same failure the funding
   * tracker exists to catch, at the other end of the process.
   */
  it('must be recorded, and says why', () => {
    expect(deed.recording).toBeTruthy()
    expect(deed.recording).toMatch(/registry of deeds/i)
    expect(deed.notes.join(' ')).toMatch(/not recorded/i)
  })
})

describe('a revocable trust', () => {
  const trust = requirementsFor('trust')

  it('needs no witnesses', () => {
    expect(trust.witnesses).toBe(0)
    expect(trust.citation).toContain('203E')
  })

  /**
   * Notarisation is not a condition of validity and is done every time anyway,
   * because a bank or the Registry will refuse the trust without it. Saying
   * "required in practice" rather than "required" keeps the statute and the
   * habit distinguishable.
   */
  it('is notarised in practice even though the statute does not demand it', () => {
    expect(trust.notary).toBe('required_in_practice')
  })

  it('is signed by the settlor and accepted by the trustee', () => {
    expect(trust.signers).toEqual(expect.arrayContaining(['Settlor', 'Trustee']))
  })
})

describe('an advance directive', () => {
  /**
   * Massachusetts has no living-will statute. The document carries weight as
   * evidence of the client's wishes rather than as a binding directive, and an
   * engine that quietly listed it beside the will would imply otherwise.
   */
  it('says plainly that Massachusetts has no living-will statute', () => {
    const directive = requirementsFor('advance_directive')
    expect(directive.notes.join(' ')).toMatch(/no living[- ]will statute/i)
    expect(directive.witnesses).toBe(2)
  })
})

describe('a HIPAA authorization', () => {
  it('needs neither witnesses nor a notary', () => {
    const hipaa = requirementsFor('hipaa_authorization')
    expect(hipaa.witnesses).toBe(0)
    expect(hipaa.notary).toBe('not_required')
    expect(hipaa.citation).toContain('164.508')
  })
})

describe('ceremonyPlan', () => {
  it('asks for the most witnesses any one document needs, not the sum', () => {
    // The same two people witness everything in one sitting.
    const plan = ceremonyPlan(['will', 'health_care_proxy', 'trust'])
    expect(plan.witnessesNeeded).toBe(2)
  })

  it('needs no witnesses when nothing being signed calls for them', () => {
    expect(ceremonyPlan(['trust', 'hipaa_authorization']).witnessesNeeded).toBe(0)
  })

  it('says a notary must attend when any document requires one', () => {
    expect(ceremonyPlan(['deed', 'hipaa_authorization']).notaryRequired).toBe(true)
    expect(ceremonyPlan(['hipaa_authorization']).notaryRequired).toBe(false)
  })

  it('counts a self-proving affidavit as a reason to have the notary there', () => {
    // Without the notary the will is still valid, and probate gets harder.
    const plan = ceremonyPlan(['will'])
    expect(plan.notaryRequired).toBe(true)
    expect(plan.notaryReasons.join(' ')).toMatch(/self-proving/i)
  })

  it('gathers every witness disqualification across the set', () => {
    const plan = ceremonyPlan(['will', 'health_care_proxy'])
    expect(plan.disqualifiedWitnesses.join(' ')).toMatch(/agent/i)
  })

  it('lists what must be recorded afterwards, which is not done at the table', () => {
    const plan = ceremonyPlan(['will', 'deed', 'homestead_declaration'])
    expect(plan.recordings).toHaveLength(2)
    expect(plan.recordings.join(' ')).toMatch(/registry of deeds/i)
  })

  it('has nothing to say about an empty ceremony', () => {
    expect(ceremonyPlan([])).toMatchObject({
      witnessesNeeded: 0,
      notaryRequired: false,
      recordings: [],
    })
  })

  it('ignores a kind it does not know rather than inventing requirements for it', () => {
    const plan = ceremonyPlan(['will', 'interpretive_dance' as never])
    expect(plan.witnessesNeeded).toBe(2)
    expect(plan.documents.map((d) => d.kind)).toEqual(['will'])
    expect(plan.unknownKinds).toEqual(['interpretive_dance'])
  })

  it('orders documents so the witnessed ones come first', () => {
    // They are signed together while the witnesses are in the room.
    const plan = ceremonyPlan(['hipaa_authorization', 'will', 'trust'])
    expect(plan.documents[0].kind).toBe('will')
  })
})
