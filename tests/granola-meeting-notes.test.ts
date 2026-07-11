import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GranolaError, isGranolaNoteId } from '@/lib/granola'

describe('granola meeting notes integration', () => {
  it('validates Granola note ids', () => {
    expect(isGranolaNoteId('not_abcdefghijklmn')).toBe(true)
    expect(isGranolaNoteId('not_')).toBe(false)
    expect(isGranolaNoteId('uuid-from-web-url')).toBe(false)
    expect(isGranolaNoteId('')).toBe(false)
  })

  it('exposes admin granola list and fetch routes with auth', () => {
    const list = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/granola/list/route.ts'),
      'utf8',
    )
    const fetch = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/granola/fetch/route.ts'),
      'utf8',
    )
    expect(list).toContain('requireAdmin')
    expect(list).toContain('listRecentNotes')
    expect(fetch).toContain('requireAdmin')
    expect(fetch).toContain('isGranolaNoteId')
    expect(fetch).toContain('fetchGranolaNote')
  })

  it('saves matter meeting notes to meeting-notes folder without lead support', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/meeting-notes/route.ts'),
      'utf8',
    )
    expect(route).toContain("folder: 'meeting-notes'")
    expect(route).toContain('meeting-notes/')
    expect(route).not.toContain('lead')
    expect(route).toContain('matter_activity')
  })

  it('wires meeting notes card and dialog on matter detail', () => {
    const detail = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'),
      'utf8',
    )
    const card = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/MatterMeetingNotesCard.tsx'),
      'utf8',
    )
    const dialog = fs.readFileSync(
      path.join(process.cwd(), 'components/meeting-notes/AddMeetingNotesDialog.tsx'),
      'utf8',
    )
    expect(detail).toContain('MatterMeetingNotesCard')
    expect(card).toContain('Meeting notes')
    expect(card).toContain("listDocuments(matterId, 'meeting-notes')")
    expect(card).toContain('AddMeetingNotesDialog')
    expect(dialog).toContain('/api/admin/granola/list')
    expect(dialog).toContain('/api/admin/meeting-notes')
    expect(dialog).not.toContain('leadId')
  })

  it('maps Granola errors to HTTP status codes', () => {
    const err = new GranolaError(503, 'missing key')
    expect(err.status).toBe(503)
    expect(err.message).toBe('missing key')
  })
})
