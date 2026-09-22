import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAgreement=vi.fn()
vi.mock('@/lib/engagement/repository',()=>({getAgreement}))
vi.mock('@/lib/supabaseAdmin',()=>({getAdminClient:()=>({})}))
vi.mock('@/lib/supabaseServer',()=>({getCachedClaims:vi.fn(),getCachedUserRole:vi.fn()}))

describe('engagement scoped production loader',()=>{
  beforeEach(()=>vi.clearAllMocks())
  it.each([
    {matter_id:null,lead_id:null,active_revision:{input_snapshot:{practiceArea:'EP',clientMode:'couple',scopeKey:'standard',legalPlan:null}}},
    {matter_id:'m1',active_revision:{input_snapshot:{practiceArea:'Probate',clientMode:'couple',scopeKey:'standard',legalPlan:null}}},
    {matter_id:'m1',active_revision:{input_snapshot:{practiceArea:'EP-LP',clientMode:'individual',scopeKey:'standard',legalPlan:null}}},
  ])('rejects ownerless and unsupported definitions',async data=>{
    getAgreement.mockResolvedValue(data)
    const {getScopedAgreement}=await import('@/lib/engagement/http')
    await expect(getScopedAgreement('a1')).rejects.toThrow(/unavailable/)
  })
  it('accepts a supported lead-backed definition',async()=>{
    const data={matter_id:null,lead_id:'l1',active_revision:{input_snapshot:{practiceArea:'EP',clientMode:'couple',scopeKey:'standard',legalPlan:null}}}
    getAgreement.mockResolvedValue(data)
    const {getScopedAgreement}=await import('@/lib/engagement/http')
    await expect(getScopedAgreement('a1')).resolves.toBe(data)
  })
})
