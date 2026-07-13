import { describe, expect, it } from 'vitest'
import { canSendReviewedRevision, engagementStep, isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'

describe('engagement workspace interaction state', () => {
  it('keeps drafting-style URL steps stable and maps legacy steps safely', () => {
    for (const step of ['design','generate','review']) expect(engagementStep(step)).toBe(step)
    expect(engagementStep('details')).toBe('design')
    expect(engagementStep('terms')).toBe('design')
    expect(engagementStep('send')).toBe('review')
    expect(engagementStep('status')).toBe('review')
    expect(engagementStep('unknown')).toBe('design')
  })
  it('enables send only after explicit confirmation of a complete reviewed identity', () => {
    const valid={approvalToken:'token',confirmExactRevision:true,revisionId:'r1',pdfSha256:'hash'}
    expect(canSendReviewedRevision(valid)).toBe(true)
    for (const patch of [{approvalToken:''},{confirmExactRevision:false},{revisionId:''},{pdfSha256:''}]) expect(canSendReviewedRevision({...valid,...patch})).toBe(false)
  })
  it('supports matter- and lead-backed couple workspaces and fails closed otherwise', () => {
    const valid={matterId:'m1',practiceArea:'EP',clientMode:'couple',scopeKey:'standard',legalPlan:null}
    expect(isSupportedWorkspaceDefinition(valid)).toBe(true)
    expect(isSupportedWorkspaceDefinition({...valid,matterId:null,leadId:'l1'})).toBe(true)
    expect(isSupportedWorkspaceDefinition({...valid,matterId:null,leadId:null})).toBe(false)
    expect(isSupportedWorkspaceDefinition({...valid,clientMode:'individual'})).toBe(false)
  })
})
