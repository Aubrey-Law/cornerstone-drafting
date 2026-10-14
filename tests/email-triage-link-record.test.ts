import { describe, expect, it } from 'vitest'
import { applyManualLinkOnScan, resolveEmailTriageLink } from '@/lib/emailTriage/linkRecord'
import type { SenderMatch } from '@/lib/emailTriage/classifySender'

describe('resolveEmailTriageLink', () => {
  it('links a matter as a client and marks the row manual', () => {
    expect(resolveEmailTriageLink({
      matterId: 'matter-1',
      matterIntakeId: 'intake-1',
    })).toEqual({
      classification: 'client',
      client_intake_id: 'intake-1',
      matter_id: 'matter-1',
      contact_id: null,
      classification_reason: 'Linked manually in Mail Desk',
      record_linked_manually: true,
    })
  })

  it('links a lead and keeps any matter already on that lead', () => {
    expect(resolveEmailTriageLink({
      leadId: 'lead-1',
      leadMatterId: 'matter-2',
    })).toEqual({
      classification: 'lead',
      client_intake_id: 'lead-1',
      matter_id: 'matter-2',
      contact_id: null,
      classification_reason: 'Linked manually in Mail Desk',
      record_linked_manually: true,
    })
  })

  it('prefers matter over lead when both are present', () => {
    const resolved = resolveEmailTriageLink({
      leadId: 'lead-1',
      matterId: 'matter-1',
      matterIntakeId: 'intake-1',
    })
    expect(resolved).toMatchObject({
      classification: 'client',
      matter_id: 'matter-1',
      client_intake_id: 'intake-1',
      record_linked_manually: true,
    })
  })

  it('unlinks back to possible_lead so the next scan can re-classify', () => {
    expect(resolveEmailTriageLink({ unlink: true })).toEqual({
      classification: 'possible_lead',
      client_intake_id: null,
      matter_id: null,
      contact_id: null,
      classification_reason: 'Unlinked in Mail Desk',
      record_linked_manually: false,
    })
  })

  it('rejects an empty link body', () => {
    expect(resolveEmailTriageLink({})).toEqual({
      error: 'Choose a lead or matter to link.',
    })
  })
})

describe('applyManualLinkOnScan', () => {
  const automated: SenderMatch = {
    classification: 'automated',
    clientIntakeId: null,
    matterId: null,
    contactId: null,
    displayName: null,
    reason: 'noreply local-part',
    automatedHard: true,
  }

  it('leaves an automatic match alone when the row was not linked by hand', () => {
    const next = applyManualLinkOnScan(automated, {
      record_linked_manually: false,
      classification: 'possible_lead',
      client_intake_id: null,
      matter_id: null,
      contact_id: null,
      classification_reason: null,
    })
    expect(next.classification).toBe('automated')
    expect(next.recordLinkedManually).toBe(false)
  })

  it('keeps a manual client link instead of filing the sender as Noise', () => {
    const next = applyManualLinkOnScan(automated, {
      record_linked_manually: true,
      classification: 'client',
      client_intake_id: 'intake-1',
      matter_id: 'matter-1',
      contact_id: null,
      classification_reason: 'Linked manually in Mail Desk',
    })
    expect(next).toMatchObject({
      classification: 'client',
      clientIntakeId: 'intake-1',
      matterId: 'matter-1',
      reason: 'Linked manually in Mail Desk',
      recordLinkedManually: true,
    })
  })
})
