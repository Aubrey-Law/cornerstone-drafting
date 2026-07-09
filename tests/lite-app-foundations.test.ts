import { describe, expect, it } from 'vitest'
import { mapMatterStageToEngine, engineStageLabel } from '@/lib/stage-engine/labels'
import {
  safeAdminRedirectPath,
  safeClientRedirectPath,
  safeRedirectPathForRole,
} from '@/lib/auth/safeRedirect'
import { retellWebhookToRow, RETELL_UPSERT_EVENTS } from '@/lib/retell/normalize'
import type { RetellWebhookPayload } from '@/lib/retell/types'
import { isClientPortalFirmDocument } from '@/lib/documentSharing'

describe('mapMatterStageToEngine', () => {
  it('maps early stages to design_input', () => {
    expect(mapMatterStageToEngine('intake')).toBe('design_input')
    expect(mapMatterStageToEngine('intake_review')).toBe('design_input')
    expect(mapMatterStageToEngine('design')).toBe('design_input')
  })

  it('maps mid and late stages', () => {
    expect(mapMatterStageToEngine('drafting')).toBe('drafting')
    expect(mapMatterStageToEngine('client_review')).toBe('client_review')
    expect(mapMatterStageToEngine('revision')).toBe('revisions')
    expect(mapMatterStageToEngine('drafts_approved')).toBe('approved')
    expect(mapMatterStageToEngine('signing_scheduled')).toBe('signing_scheduled')
    expect(mapMatterStageToEngine('post_execution')).toBe('closeout')
    expect(mapMatterStageToEngine('closed')).toBe('matter_closed')
  })

  it('returns null for unknown stages', () => {
    expect(mapMatterStageToEngine('lead_discovery')).toBeNull()
    expect(mapMatterStageToEngine('')).toBeNull()
  })

  it('provides human labels', () => {
    expect(engineStageLabel('design_input')).toBe('Design Input')
    expect(engineStageLabel('client_review')).toBe('Client Review')
  })
})

describe('safe redirects', () => {
  it('allows admin paths only for staff redirects', () => {
    expect(safeAdminRedirectPath('/admin/matters')).toBe('/admin/matters')
    expect(safeAdminRedirectPath('/admin/drafting/abc')).toBe('/admin/drafting/abc')
    expect(safeAdminRedirectPath('/documents')).toBeNull()
    expect(safeAdminRedirectPath('https://evil.com')).toBeNull()
    expect(safeAdminRedirectPath('//evil.com')).toBeNull()
  })

  it('allows portal paths only for client redirects', () => {
    expect(safeClientRedirectPath('/documents')).toBe('/documents')
    expect(safeClientRedirectPath('/messages')).toBe('/messages')
    expect(safeClientRedirectPath('/intake')).toBe('/intake')
    expect(safeClientRedirectPath('/dashboard')).toBe('/dashboard')
    expect(safeClientRedirectPath('/admin/matters')).toBeNull()
    expect(safeClientRedirectPath('/plan-review')).toBeNull()
  })

  it('picks allowlist by role', () => {
    expect(safeRedirectPathForRole('/admin/drafting', 'attorney')).toBe('/admin/drafting')
    expect(safeRedirectPathForRole('/documents', 'client')).toBe('/documents')
    expect(safeRedirectPathForRole('/documents', 'attorney')).toBeNull()
    expect(safeRedirectPathForRole('/admin/matters', 'client')).toBeNull()
  })
})

describe('retellWebhookToRow', () => {
  it('normalizes a completed inbound call', () => {
    const payload: RetellWebhookPayload = {
      event: 'call_analyzed',
      call: {
        call_id: 'retell_abc',
        call_status: 'ended',
        direction: 'inbound',
        from_number: '+16175551212',
        to_number: '+16175550000',
        start_timestamp: 1_700_000_000_000,
        end_timestamp: 1_700_000_060_000,
        duration_ms: 60_000,
        transcript: 'Hello from Retell',
        recording_url: 'https://example.com/rec.mp3',
        call_analysis: { call_summary: 'Client asked about intake', in_voicemail: false },
      },
    }

    const row = retellWebhookToRow(payload)
    expect(row).not.toBeNull()
    expect(row!.provider).toBe('retell')
    expect(row!.external_call_id).toBe('retell_abc')
    expect(row!.direction).toBe('inbound')
    expect(row!.status).toBe('completed')
    expect(row!.participant_number).toBe('+16175551212')
    expect(row!.duration_seconds).toBe(60)
    expect(row!.transcript).toBe('Hello from Retell')
    expect(row!.summary).toBe('Client asked about intake')
    expect(RETELL_UPSERT_EVENTS.has('call_analyzed')).toBe(true)
  })

  it('returns null without call_id', () => {
    expect(retellWebhookToRow({ event: 'call_started', call: { call_id: '' } as never })).toBeNull()
  })
})

describe('portal document visibility (lite)', () => {
  it('keeps draft folders off the client portal', () => {
    expect(
      isClientPortalFirmDocument({ name: 'Trust.pdf', folder: 'draft', content_type: 'application/pdf' }),
    ).toBe(false)
    expect(
      isClientPortalFirmDocument({ name: 'Trust.pdf', folder: 'review', content_type: 'application/pdf' }),
    ).toBe(true)
  })
})
