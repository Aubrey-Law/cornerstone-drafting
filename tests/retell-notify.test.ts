import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatRetellAlertEmail,
  formatRetellAlertSms,
  parseRetellSummaryEmails,
  parseRetellSummarySmsTo,
  retellCallsAdminUrl,
  shouldNotifyRetellAnalyzed,
} from '@/lib/retell/notifyFormat'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

describe('retell notify helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('parses RETELL_SUMMARY_TO emails with fallback', () => {
    expect(parseRetellSummaryEmails('')).toEqual(['scott@aubreylegal.com'])
    expect(parseRetellSummaryEmails(undefined)).toEqual(['scott@aubreylegal.com'])
    expect(parseRetellSummaryEmails('scott@aubreylegal.com, other@example.com')).toEqual([
      'scott@aubreylegal.com',
      'other@example.com',
    ])
    expect(parseRetellSummaryEmails('not-an-email')).toEqual(['scott@aubreylegal.com'])
  })

  it('parses RETELL_SUMMARY_SMS_TO as E.164', () => {
    expect(parseRetellSummarySmsTo(undefined)).toBeNull()
    expect(parseRetellSummarySmsTo('')).toBeNull()
    expect(parseRetellSummarySmsTo('6175551212')).toBe('+16175551212')
    expect(parseRetellSummarySmsTo('+1 (617) 555-1212')).toBe('+16175551212')
  })

  it('dedupes notify when summary unchanged', () => {
    expect(shouldNotifyRetellAnalyzed(null, null)).toBe(false)
    expect(shouldNotifyRetellAnalyzed(null, 'Hello')).toBe(true)
    expect(shouldNotifyRetellAnalyzed('Hello', 'Hello')).toBe(false)
    expect(shouldNotifyRetellAnalyzed('Hello', 'Hello again')).toBe(true)
  })

  it('formats email subject and body with summary + admin link', () => {
    const { subject, text, html } = formatRetellAlertEmail({
      external_call_id: 'call_1',
      direction: 'inbound',
      status: 'completed',
      from_number: '+16175551212',
      to_number: '+17816753466',
      participant_number: '+16175551212',
      duration_seconds: 95,
      summary: 'Caller asked about a trust.',
      matter_id: null,
    })

    expect(subject).toContain('617')
    expect(text).toContain('Caller asked about a trust.')
    expect(text).toContain('1:35')
    expect(text).toContain('/admin/calls')
    expect(html).toContain('Caller asked about a trust.')
    expect(html).toContain('/admin/calls')
  })

  it('formats SMS within length limit', () => {
    const long = 'x'.repeat(2000)
    const body = formatRetellAlertSms({
      external_call_id: 'call_1',
      direction: 'inbound',
      status: 'completed',
      from_number: '+16175551212',
      to_number: '+17816753466',
      participant_number: '+16175551212',
      duration_seconds: 30,
      summary: long,
    })
    expect(body.length).toBeLessThanOrEqual(MAX_SMS_BODY_LENGTH)
    expect(body.startsWith('Retell')).toBe(true)
    expect(body.endsWith('…')).toBe(true)
  })

  it('links lead-associated calls to the lead detail page', () => {
    expect(retellCallsAdminUrl(null, 'lead-123')).toContain('/admin/crm/opportunities/lead-123')
  })
})
