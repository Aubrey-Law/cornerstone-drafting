import { describe, expect, it } from 'vitest'
import {
  groupLeadsByBoardColumn,
  LEAD_BOARD_COLUMNS,
  leadBoardColumn,
  resolveBoardDrop,
} from '@/lib/leads/board'
import type { LeadListRow } from '@/lib/leads/viewTypes'

function lead(overrides: Partial<LeadListRow> = {}): LeadListRow {
  return {
    id: 'lead-1',
    full_name: 'Ada Lovelace',
    first_name: null,
    last_name: null,
    email: 'ada@example.com',
    phone: null,
    practice_area: 'EP',
    status: null,
    lead_status: 'lead',
    matter_id: null,
    intake_sent_at: null,
    intake_completed_at: null,
    engagement_status: null,
    engagement_sent_at: null,
    engagement_signed_at: null,
    engagement_fee_quoted: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: null,
    lead_urgency: null,
    taxable_estate: null,
    last_activity_at: null,
    ...overrides,
  }
}

describe('lead board columns', () => {
  it('derives the column from the record rather than a stored value', () => {
    expect(leadBoardColumn(lead())).toBe('new')
    expect(leadBoardColumn(lead({ intake_sent_at: '2026-07-02T00:00:00.000Z' }))).toBe('intake_sent')
    expect(leadBoardColumn(lead({ intake_completed_at: '2026-07-03T00:00:00.000Z' }))).toBe('intake_complete')
    expect(leadBoardColumn(lead({ status: 'completed' }))).toBe('intake_complete')
    expect(leadBoardColumn(lead({ engagement_sent_at: '2026-07-04T00:00:00.000Z' }))).toBe('engagement')
    expect(leadBoardColumn(lead({ lead_status: 'hired', matter_id: 'matter-1' }))).toBe('hired')
    expect(leadBoardColumn(lead({ lead_status: 'lost' }))).toBe('lost')
  })

  it('keeps an engagement sent ahead of an unfinished intake', () => {
    const sent = lead({ intake_sent_at: '2026-07-02T00:00:00.000Z', engagement_sent_at: '2026-07-05T00:00:00.000Z' })
    expect(leadBoardColumn(sent)).toBe('engagement')
  })

  it('groups every column, including the empty ones', () => {
    const grouped = groupLeadsByBoardColumn([lead(), lead({ id: 'lead-2', lead_status: 'lost' })])
    expect([...grouped.keys()]).toEqual(LEAD_BOARD_COLUMNS.map(column => column.key))
    expect(grouped.get('new')?.map(row => row.id)).toEqual(['lead-1'])
    expect(grouped.get('lost')?.map(row => row.id)).toEqual(['lead-2'])
    expect(grouped.get('hired')).toEqual([])
  })
})

describe('lead board drops', () => {
  it('maps a drop onto the action that moves the record', () => {
    expect(resolveBoardDrop(lead(), 'intake_sent')).toEqual({ kind: 'send_intake' })
    expect(resolveBoardDrop(lead(), 'engagement')).toEqual({ kind: 'send_engagement' })
    expect(resolveBoardDrop(lead(), 'hired')).toEqual({ kind: 'hire' })
    expect(resolveBoardDrop(lead(), 'lost')).toEqual({ kind: 'mark_lost' })
    expect(resolveBoardDrop(lead({ lead_status: 'lost' }), 'new')).toEqual({ kind: 'reopen' })
  })

  it('refuses drops the firm cannot perform and explains why', () => {
    const intakeSent = lead({ intake_sent_at: '2026-07-02T00:00:00.000Z' })
    expect(resolveBoardDrop(intakeSent, 'intake_complete')).toEqual({
      kind: 'none',
      reason: 'Intake completes when the client submits it.',
    })
    expect(resolveBoardDrop(intakeSent, 'new').kind).toBe('none')
    expect(resolveBoardDrop(lead({ lead_status: 'hired' }), 'lost').kind).toBe('none')
    expect(resolveBoardDrop(lead({ lead_status: 'lost' }), 'hired').kind).toBe('none')
  })

  it('stays silent when a card is dropped back on its own column', () => {
    expect(resolveBoardDrop(lead(), 'new')).toEqual({ kind: 'none', reason: null })
  })
})

describe('declined leads on the board', () => {
  const declined = lead({ lead_status: 'declined' })

  it('places a declined lead in its own column, not by its timestamps', () => {
    // The bug this covers: without an explicit branch, a lead declined at
    // discovery — before any intake went out — lands in New looking active.
    expect(leadBoardColumn(declined)).toBe('declined')
    expect(leadBoardColumn(lead({ lead_status: 'declined', intake_sent_at: '2026-07-02T00:00:00.000Z' })))
      .toBe('declined')
  })

  it('keeps declined distinct from lost', () => {
    expect(leadBoardColumn(lead({ lead_status: 'lost' }))).toBe('lost')
    expect(LEAD_BOARD_COLUMNS.map(c => c.key)).toContain('declined')
  })

  it('groups declined leads into the declined bucket', () => {
    const grouped = groupLeadsByBoardColumn([declined, lead({ id: 'l2' })])
    expect(grouped.get('declined')?.map(l => l.id)).toEqual(['lead-1'])
    expect(grouped.get('new')?.map(l => l.id)).toEqual(['l2'])
  })

  it('reopens a declined lead only onto New', () => {
    expect(resolveBoardDrop(declined, 'new')).toEqual({ kind: 'reopen' })
    expect(resolveBoardDrop(declined, 'engagement').kind).toBe('none')
    expect(resolveBoardDrop(declined, 'hired').kind).toBe('none')
  })

  it('declines an active lead dropped on the declined column', () => {
    expect(resolveBoardDrop(lead(), 'declined')).toEqual({ kind: 'mark_declined' })
    expect(resolveBoardDrop(lead({ intake_sent_at: '2026-07-02T00:00:00.000Z' }), 'declined'))
      .toEqual({ kind: 'mark_declined' })
  })

  it('never hires a lead dropped on a column with no action', () => {
    // resolveBoardDrop used to end in a bare `return { kind: 'hire' }`, so any
    // column added later silently hired the lead on drop.
    expect(resolveBoardDrop(lead(), 'hired')).toEqual({ kind: 'hire' })
    expect(resolveBoardDrop(lead({ lead_status: 'lost' }), 'declined').kind).toBe('none')
  })
})
