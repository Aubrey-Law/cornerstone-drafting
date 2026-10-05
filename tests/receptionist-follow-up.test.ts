import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * The receptionist's follow-up. What the firm does after the AI receptionist
 * hangs up is a table of outcomes; these pin it down, and pin that each
 * outcome is a proposal through the dial rather than a direct write.
 */

vi.mock('server-only', () => ({}))

import { extractCallerFactsFromAnalysis, planReceptionistActions } from '@/lib/retell/followUp'
import { getActionDefinition } from '@/lib/actions/registry'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const CALL_ID = 'call_123'
const LEAD = '00000000-0000-0000-0000-000000000050'
const MATTER = '00000000-0000-0000-0000-000000000060'

const facts = {
  name: 'Pat Client',
  email: 'pat@example.com',
  phone: '+16175551212',
  reason: 'wants a trust for the house',
  wantsAppointment: true,
  requestedTimeIso: '2026-10-07T14:00:00.000Z',
  claimsExistingClient: false,
}

describe('reading the call', () => {
  it('takes the agent’s own extracted fields when present and ignores a past time', () => {
    const read = extractCallerFactsFromAnalysis({
      call_id: CALL_ID,
      call_analysis: { custom_analysis_data: { caller_name: ' Pat  Client ', caller_email: 'PAT@example.com', wants_appointment: 'yes', requested_time: '2020-01-01T10:00:00Z', reason: 'trust' } },
    }, NOW)
    expect(read).toMatchObject({ name: 'Pat Client', email: 'pat@example.com', wantsAppointment: true, requestedTimeIso: null, reason: 'trust' })
  })

  it('returns nothing to act on when the agent captured nothing', () => {
    expect(extractCallerFactsFromAnalysis({ call_id: CALL_ID, call_analysis: {} }, NOW)).toBeNull()
    expect(extractCallerFactsFromAnalysis({ call_id: CALL_ID, call_analysis: { custom_analysis_data: { caller_email: 'not-an-email' } } }, NOW)).toBeNull()
  })
})

describe('what the receptionist proposes', () => {
  const base = { callId: CALL_ID, fromNumber: '+16175551212', summary: 'Pat called about a trust.', voicemail: false, now: NOW }

  it('gives an existing client’s call back to the attorney, whatever was asked', () => {
    const plan = planReceptionistActions({ ...base, facts, match: { kind: 'matter', id: MATTER, name: 'Pat Client' } })
    expect(plan.map(item => item.actionKey)).toEqual(['task.create'])
    expect(plan[0].payload).toMatchObject({ matter_id: MATTER, lead_id: null, priority: 'high' })
    expect(plan[0].summary).toContain('Return the call from Pat Client')
  })

  it('books the discovery call when a lead or stranger named a time', () => {
    const asLead = planReceptionistActions({ ...base, facts, match: { kind: 'lead', id: LEAD, name: 'Pat Client' } })
    expect(asLead.map(item => item.actionKey)).toEqual(['appointment.book'])
    expect(asLead[0].payload).toMatchObject({ typeKey: 'discovery_call', startIso: facts.requestedTimeIso, firstName: 'Pat', lastName: 'Client', email: 'pat@example.com', leadId: LEAD })
    const asStranger = planReceptionistActions({ ...base, facts, match: { kind: 'none' } })
    expect(asStranger.map(item => item.actionKey)).toEqual(['appointment.book'])
    expect(asStranger[0].payload).toMatchObject({ leadId: null })
  })

  it('sends the link, and creates the lead for a stranger, when no time was named', () => {
    const noTime = { ...facts, requestedTimeIso: null }
    expect(planReceptionistActions({ ...base, facts: noTime, match: { kind: 'none' } }).map(item => item.actionKey))
      .toEqual(['lead.create', 'scheduling.link.send'])
    expect(planReceptionistActions({ ...base, facts: noTime, match: { kind: 'lead', id: LEAD, name: null } }).map(item => item.actionKey))
      .toEqual(['scheduling.link.send'])
  })

  it('never books on a single-word name; it sends the link instead', () => {
    const plan = planReceptionistActions({ ...base, facts: { ...facts, name: 'Pat' }, match: { kind: 'none' } })
    expect(plan.map(item => item.actionKey)).toEqual(['lead.create', 'scheduling.link.send'])
  })

  it('leaves a known lead who wants nothing bookable as a callback task', () => {
    const plan = planReceptionistActions({ ...base, facts: { ...facts, wantsAppointment: false, requestedTimeIso: null }, match: { kind: 'lead', id: LEAD, name: 'Pat Client' } })
    expect(plan.map(item => item.actionKey)).toEqual(['task.create'])
    expect(plan[0].payload).toMatchObject({ lead_id: LEAD, matter_id: null })
  })

  it('proposes nothing for a stranger with no email, since the summary email already went out', () => {
    expect(planReceptionistActions({ ...base, facts: null, match: { kind: 'none' } })).toEqual([])
    expect(planReceptionistActions({ ...base, facts: { ...facts, email: null, wantsAppointment: false }, match: { kind: 'none' } })).toEqual([])
  })

  it('describes a voicemail as one in the callback task', () => {
    const plan = planReceptionistActions({ ...base, voicemail: true, facts: null, match: { kind: 'lead', id: LEAD, name: 'Pat Client' } })
    expect(plan[0].summary).toContain('left a voicemail')
    expect(plan[0].payload.description).toContain('Voicemail left')
  })
})

describe('the booking and link actions', () => {
  it('are external writes with no undo', () => {
    for (const key of ['appointment.book', 'scheduling.link.send']) {
      const definition = getActionDefinition(key)
      expect(definition?.risk, key).toBe('external_write')
      expect(definition?.undo, key).toBeUndefined()
    }
  })

  it('refuse a past start time and a bad email', () => {
    const book = getActionDefinition('appointment.book')!
    expect(() => book.validate({ typeKey: 'discovery_call', startIso: '2020-01-01T10:00:00Z', firstName: 'Pat', lastName: 'Client', email: 'pat@example.com' }, { id: 'u' })).toThrow('future start time')
    expect(() => book.validate({ typeKey: 'discovery_call', startIso: '2999-01-01T10:00:00Z', firstName: 'Pat', lastName: 'Client', email: 'nope' }, { id: 'u' })).toThrow('valid attendee email')
    const link = getActionDefinition('scheduling.link.send')!
    expect(() => link.validate({ email: 'nope', meetingTypeKey: 'discovery_call' }, { id: 'u' })).toThrow('valid recipient email')
  })
})

describe('where the follow-up runs', () => {
  it('runs after the summary email, once per new summary, and never fails the webhook', () => {
    const route = fs.readFileSync('app/api/webhooks/retell/route.ts', 'utf8')
    expect(route.indexOf('await notifyRetellCallAnalyzed(')).toBeLessThan(route.indexOf('await runReceptionistFollowUp('))
    expect(route).toContain("result.previous_summary?.trim() !== merged.summary?.trim()")
    const block = route.slice(route.indexOf('await runReceptionistFollowUp('))
    expect(block).toContain('catch (error)')
  })

  it('hands every step to the dial as an automation proposal keyed to the call', () => {
    const source = fs.readFileSync('lib/retell/followUp.ts', 'utf8')
    expect(source).toContain("source: 'automation'")
    expect(source).toContain('applyAutonomy: true')
    expect(source).toContain('idempotencyKey: `receptionist:${call.external_call_id}:${item.actionKey}`')
    expect(source).not.toContain("from('tasks').insert")
  })
})
