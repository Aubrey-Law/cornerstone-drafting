import { describe, expect, it } from 'vitest'
import { computePortalNextAction } from '@/lib/portal/nextActions'

const complete = {
  hasMatter: true,
  intakeComplete: true,
  matterStatus: 'active',
  matterStage: 'drafting',
  sharedDocumentCount: 0,
  unreadFirmMessageCount: 0,
  hasUpcomingAppointment: false,
  outstandingInvoiceCount: 0,
  factsAvailable: true,
} as const

describe('portal next actions', () => {
  it('directs an incomplete intake to the questionnaire', () => {
    expect(computePortalNextAction({ ...complete, intakeComplete: false })).toMatchObject({
      kind: 'intake', label: 'Continue intake', href: '/intake',
    })
  })

  it('directs client review to firm-shared documents', () => {
    expect(computePortalNextAction({ ...complete, matterStage: 'client_review', sharedDocumentCount: 1 })).toMatchObject({
      kind: 'review', label: 'Review documents', href: '/documents',
    })
  })

  it.each([
    { matterStage: 'client_review', sharedDocumentCount: 0 },
    { matterStage: 'drafting', sharedDocumentCount: 2 },
  ] as const)('does not claim review is actionable without both recorded facts: %j', overrides => {
    expect(computePortalNextAction({ ...complete, ...overrides }).kind).toBe('clear')
  })

  it('directs the client to unread firm messages', () => {
    expect(computePortalNextAction({ ...complete, unreadFirmMessageCount: 2 })).toMatchObject({
      kind: 'message', label: 'Read messages', href: '/messages',
    })
  })

  it('suppresses stale work for closed and archived matters', () => {
    for (const matterStatus of ['closed', 'archived']) {
      expect(computePortalNextAction({
        ...complete,
        matterStatus,
        matterStage: 'client_review',
        sharedDocumentCount: 2,
        unreadFirmMessageCount: 0,
      }).kind).toBe('closed')
    }
  })

  it('keeps actual obligations and unavailable facts visible after closure', () => {
    for (const matterStatus of ['closed', 'archived']) {
      expect(computePortalNextAction({ ...complete, matterStatus, outstandingInvoiceCount: 1 }).kind).toBe('account')
      expect(computePortalNextAction({ ...complete, matterStatus, unreadFirmMessageCount: 1 }).kind).toBe('message')
      expect(computePortalNextAction({ ...complete, matterStatus, hasUpcomingAppointment: true }).kind).toBe('appointment')
      expect(computePortalNextAction({ ...complete, matterStatus, factsAvailable: false }).kind).toBe('unavailable')
    }
  })

  it('acknowledges a submitted intake without inventing an active matter', () => {
    expect(computePortalNextAction({ ...complete, hasMatter: false })).toMatchObject({ kind: 'waiting', href: null })
  })

  it('links a recorded upcoming appointment', () => {
    expect(computePortalNextAction({ ...complete, hasUpcomingAppointment: true })).toMatchObject({
      kind: 'appointment', label: 'View appointment', href: '/schedule',
    })
  })

  it('links an actually issued invoice with an outstanding balance', () => {
    expect(computePortalNextAction({ ...complete, outstandingInvoiceCount: 1 })).toMatchObject({
      kind: 'account', label: 'View billing', href: '/account',
    })
  })

  it('says nothing is needed after all recorded facts load', () => {
    expect(computePortalNextAction(complete)).toMatchObject({ kind: 'clear', href: null, label: null })
  })

  it('does not represent failed next-action reads as all clear', () => {
    expect(computePortalNextAction({ ...complete, factsAvailable: false })).toMatchObject({
      kind: 'unavailable', label: 'Retry', href: '/dashboard',
    })
  })
})
