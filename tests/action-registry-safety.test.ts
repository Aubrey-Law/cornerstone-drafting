import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { actionDigest, confirmationPolicyForRisk } from '@/lib/actions/server'

describe('Phase 3 action safety boundaries', () => {
  it('uses deterministic digests independent of object key order', () => {
    expect(actionDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(actionDigest({ a: { c: 3, d: 4 }, b: 2 }))
    expect(actionDigest({ content: 'approved' })).not.toBe(actionDigest({ content: 'changed' }))
  })

  it('requires exact confirmation for external and consequential actions', () => {
    expect(confirmationPolicyForRisk('read')).toBe('automatic')
    expect(confirmationPolicyForRisk('prepare')).toBe('automatic')
    expect(confirmationPolicyForRisk('internal_write')).toBe('one_click')
    expect(confirmationPolicyForRisk('external_write')).toBe('explicit')
    expect(confirmationPolicyForRisk('legal_financial')).toBe('explicit')
    expect(confirmationPolicyForRisk('prohibited')).toBe('never')
  })

  it('atomically reserves idempotency before side effects and removes browser mutation grants', () => {
    const sql = fs.readFileSync('supabase/migrations/20270102090300_agent_action_registry.sql', 'utf8')
    expect(sql).toContain('for update;')
    expect(sql).toContain("v_proposal.preview_digest <> p_preview_digest")
    expect(sql).toContain("p_confirmation_digest <> p_preview_digest")
    expect(sql).toContain("'running', v_proposal.idempotency_key")
    expect(sql).toContain('revoke select, insert, update, delete on table public.action_proposals from authenticated')
    expect(sql).not.toContain('reference_payload\n) on table public.action_proposals to authenticated')
    expect(sql).toContain('grant execute on function public.claim_action_execution')
  })

  it('checks a fresh preview and claims the execution before calling the executor', () => {
    const file = fs.readFileSync('lib/actions/server.ts', 'utf8')
    const source = file.slice(file.indexOf('export async function executeActionProposal'))
    const freshPreview = source.indexOf('const executionPreview = await definition.preview')
    const staleCheck = source.indexOf("proposal.preview_digest !== currentDigest")
    const claim = source.indexOf("admin.rpc('claim_action_execution'")
    const execute = source.indexOf('result = await definition.execute')
    expect(freshPreview).toBeGreaterThan(0)
    expect(staleCheck).toBeGreaterThan(freshPreview)
    expect(claim).toBeGreaterThan(staleCheck)
    expect(execute).toBeGreaterThan(claim)
  })

  it('keeps exact external content in the confirmation preview, not the audit projection', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const actionStart = source.indexOf("key: 'email.draft.send'")
    const action = source.slice(actionStart)
    expect(action).toContain("display: { action: 'Send email', ...display }")
    expect(action).toContain("auditAfter: { draftId: input.draftId, channel: 'email'")
    expect(action).not.toContain('auditAfter: { content:')
  })
})
