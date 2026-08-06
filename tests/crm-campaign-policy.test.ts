import { describe, expect, it } from 'vitest'
import {
  canEnrollMarketingProfile,
  isTerminalDeliveryStatus,
  mapMailgunEvent,
} from '@/lib/crm/campaignPolicy'

describe('CRM campaign policy', () => {
  it('requires explicit consent and keeps nurture limited to leads', () => {
    expect(canEnrollMarketingProfile({ marketingStatus: 'opted_in', recordKind: 'lead', email: 'lead@example.com' }, 'nurture')).toBe(true)
    expect(canEnrollMarketingProfile({ marketingStatus: 'opted_in', recordKind: 'client', email: 'client@example.com' }, 'nurture')).toBe(false)
    expect(canEnrollMarketingProfile({ marketingStatus: 'unknown', recordKind: 'lead', email: 'lead@example.com' }, 'newsletter')).toBe(false)
  })

  it('protects terminal recipient states when an audience is refreshed', () => {
    expect(isTerminalDeliveryStatus('sent')).toBe(true)
    expect(isTerminalDeliveryStatus('unsubscribed')).toBe(true)
    expect(isTerminalDeliveryStatus('queued')).toBe(false)
  })

  it('normalizes Mailgun delivery events', () => {
    expect(mapMailgunEvent('permanent_fail')).toBe('bounced')
    expect(mapMailgunEvent('complained')).toBe('complaint')
    expect(mapMailgunEvent('accepted')).toBe('sent')
  })
})
