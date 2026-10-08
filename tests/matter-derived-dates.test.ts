import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDraftingDate } from '@/lib/matter/draftingDates'
import { presentNextAction, isOnWeeklyBoard, daysUntil } from '@/lib/matter/nextActionDate'
import {
  calculateMAEstateTax,
  calculateMAEstateTaxWithCreditShelter,
  MA_ESTATE_TAX_EXEMPTION,
} from '@/lib/estateTax'
import type { MatterDetailsRow } from '@/types/matter-details'

describe('moving the target signing date', () => {
  const stored: MatterDetailsRow = {
    scheduled_signing_date: '2026-09-18T12:00:00.000Z',
    // The attorney pinned drafts review; revisions was never touched.
    client_review_date: '2026-09-01',
  }

  it('reschedules only the dates nobody has set', () => {
    const moved: MatterDetailsRow = { ...stored, scheduled_signing_date: '2026-10-16T12:00:00.000Z' }

    // Pinned: unchanged by the move.
    expect(resolveDraftingDate(stored, 'drafts_review').value).toBe('2026-09-01')
    expect(resolveDraftingDate(moved, 'drafts_review').value).toBe('2026-09-01')

    // Derived: follows the anchor.
    expect(resolveDraftingDate(stored, 'revisions').value).toBe('2026-09-11')
    expect(resolveDraftingDate(moved, 'revisions').value).toBe('2026-10-09')
    expect(resolveDraftingDate(moved, 'drafts_due').value).toBe('2026-09-28')
  })

  it('marks which dates were derived so the rail can say so', () => {
    expect(resolveDraftingDate(stored, 'drafts_review').derived).toBe(false)
    expect(resolveDraftingDate(stored, 'revisions').derived).toBe(true)
  })
})

describe('next action date', () => {
  const today = '2026-08-06'

  it('counts whole days in either direction', () => {
    expect(daysUntil('2026-08-06', today)).toBe(0)
    expect(daysUntil('2026-08-09', today)).toBe(3)
    expect(daysUntil('2026-08-01', today)).toBe(-5)
  })

  it('reads as overdue, today, or a countdown', () => {
    expect(presentNextAction('2026-08-01', today)).toMatchObject({ tone: 'overdue', label: 'Next action 5d overdue' })
    expect(presentNextAction('2026-08-06', today)).toMatchObject({ tone: 'today' })
    expect(presentNextAction('2026-08-07', today)).toMatchObject({ tone: 'soon', label: 'Next action tomorrow' })
    expect(presentNextAction('2026-09-30', today)).toMatchObject({ tone: 'later' })
    expect(presentNextAction(null, today)).toBeNull()
  })

  it('puts the coming week and anything past on the weekly board', () => {
    expect(isOnWeeklyBoard('2026-08-01', today)).toBe(true)
    expect(isOnWeeklyBoard('2026-08-13', today)).toBe(true)
    expect(isOnWeeklyBoard('2026-08-14', today)).toBe(false)
    expect(isOnWeeklyBoard(null, today)).toBe(false)
  })

  it('drives the weekly board without duplicating a status pill in the matter header', () => {
    const header = fs.readFileSync(
      path.join(process.cwd(), 'components/matter/MatterWorkspaceHeader.tsx'),
      'utf8',
    )
    const board = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/components/NextActionsCard.tsx'),
      'utf8',
    )
    expect(header).not.toContain('presentNextAction')
    expect(board).toContain('next_action_date')
  })
})

describe('credit shelter tax', () => {
  it('shelters one exemption and reuses the same credit table', () => {
    const gross = 4_000_000
    expect(calculateMAEstateTaxWithCreditShelter(gross)).toBe(
      calculateMAEstateTax(gross - MA_ESTATE_TAX_EXEMPTION),
    )
  })

  it('never makes an estate under the exemption worse', () => {
    expect(calculateMAEstateTaxWithCreditShelter(1_500_000)).toBe(0)
    expect(calculateMAEstateTaxWithCreditShelter(0)).toBe(0)
  })

  it('saves something real on a taxable estate', () => {
    const gross = 5_000_000
    expect(calculateMAEstateTaxWithCreditShelter(gross)).toBeLessThan(calculateMAEstateTax(gross))
  })
})
