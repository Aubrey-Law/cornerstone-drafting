import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAgreementDraft } from '@/lib/engagement/repository'
import type { EngagementInput } from '@/lib/engagement/types'

const input = {
  practiceArea: 'EP-LP',
  clientMode: 'couple',
  scopeKey: 'standard',
  legalPlan: 'metlife',
  agreementDate: '2026-10-05',
  primary: { name: 'Alex Client', email: 'family@example.com' },
  spouse: { name: 'Sam Client', email: 'family@example.com' },
  decedentName: null,
  fee: { amount: 0, paymentTerms: '' },
  optionalClauseKeys: [],
  emailMessage: 'Please sign.',
  expirationHours: 168,
} as unknown as EngagementInput

function fakeClient(recipientError: { message: string } | null) {
  const deleted: string[] = []
  const client = {
    from(table: string) {
      if (table === 'engagement_agreements') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'agreement-1' }, error: null }) }) }),
          delete: () => ({ eq: async (_column: string, id: string) => { deleted.push(id); return { error: null } } }),
        }
      }
      return { insert: async () => ({ error: recipientError }) }
    },
    rpc: vi.fn(() => ({ single: async () => ({ data: { id: 'revision-1' }, error: null }) })),
  }
  return { client: client as unknown as SupabaseClient, deleted }
}

describe('createAgreementDraft', () => {
  it('removes the agreement when its recipients cannot be saved, leaving no orphan draft', async () => {
    const { client, deleted } = fakeClient({ message: 'duplicate key value violates unique constraint' })
    await expect(createAgreementDraft(client, {
      matterId: 'matter-1', inputSnapshot: input, renderSha256: 'unrendered', masterVersion: '0',
    })).rejects.toThrow(/duplicate key/)
    expect(deleted).toEqual(['agreement-1'])
  })

  it('keeps the agreement when the draft is created', async () => {
    const { client, deleted } = fakeClient(null)
    await expect(createAgreementDraft(client, {
      matterId: 'matter-1', inputSnapshot: input, renderSha256: 'unrendered', masterVersion: '0',
    })).resolves.toMatchObject({ agreementId: 'agreement-1' })
    expect(deleted).toEqual([])
  })
})
