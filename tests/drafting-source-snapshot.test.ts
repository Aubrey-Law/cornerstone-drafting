import { beforeEach, expect, it, vi } from 'vitest'
import type { DesignSheet } from '@/types/database'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ payload: vi.fn() }))
vi.mock('@/lib/buildDraftPayload', () => ({ buildDraftPayload: mocks.payload }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/drafting/projectDesignSheet', () => ({ projectDraftPayloadToFlatSheet: () => ({}) }))
vi.mock('@/lib/drafting/variables', () => ({ buildClientVariables: () => ({}), buildSpouseVariables: () => ({}), escapeXml: (v: string) => v }))
import { draftingSheetInputs } from '@/lib/drafting/sourceSnapshot'
import { generateDocuments } from '@/lib/drafting/generateDocuments'
import { sourceRevision } from '@/lib/drafting/runState'
beforeEach(() => vi.clearAllMocks())
it('excludes workflow-only metadata while keeping substantive deed decisions in identity', () => {
  const sheet = { id: 's', status: 'draft', updated_at: 'earlier', version: 1, decisions: { real_estate_transfer: { grantor: 'A' } } } as unknown as DesignSheet
  const revised = { ...sheet, status: 'generated' as const, updated_at: 'later', version: 2 }
  expect(sourceRevision(draftingSheetInputs(sheet))).toBe(sourceRevision(draftingSheetInputs(revised)))
  expect(sourceRevision(draftingSheetInputs(sheet))).not.toBe(sourceRevision(draftingSheetInputs({ ...sheet, decisions: { real_estate_transfer: { grantor: 'B' } } })))
})
it('the Supabase renderer uses captured data and selections without rereading either', async () => {
  const from = vi.fn(() => { throw new Error('Unexpected live data read') })
  const result = await generateDocuments({ from } as unknown as SupabaseClient, 's', 'actor', undefined, { payload: {} as DraftPayload, sheet: { matter_id: 'm' } as DesignSheet, selections: [] })
  expect(result).toMatchObject({ ok: false, error: 'No documents selected' })
  expect(mocks.payload).not.toHaveBeenCalled()
  expect(from).not.toHaveBeenCalled()
})
