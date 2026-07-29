import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadFirmSettings } = vi.hoisted(() => ({ loadFirmSettings: vi.fn() }))
vi.mock('@/lib/firmSettings', () => ({ loadFirmSettings }))

import { assembleManualEmail } from '@/lib/email/manualAssembly'

beforeEach(() => {
  loadFirmSettings.mockReset()
  loadFirmSettings.mockResolvedValue({
    firmName: 'Aubrey Law',
    email: 'office@example.com',
    city: 'Acton',
    emailLogoHeader: false,
    emailSignatureHtml: '<p>Attorney Aubrey<br><a href="https://example.com">Aubrey Law</a></p>',
    emailSignatureDefault: true,
  })
})

describe('manual email assembly', () => {
  it('appends the current signature to HTML and text exactly once', async () => {
    const result = await assembleManualEmail({
      html: '<p>Hello Jane</p>',
      text: 'Hello Jane',
      includeSignature: true,
    })

    expect(result.signatureIncluded).toBe(true)
    expect(result.html.match(/data-email-signature/g)).toHaveLength(1)
    expect(result.html).toContain('Attorney Aubrey')
    expect(result.text).toBe('Hello Jane\n\nAttorney Aubrey\nAubrey Law')
  })

  it('omits the signature when the draft opts out', async () => {
    const result = await assembleManualEmail({
      html: '<p>Hello Jane</p>',
      includeSignature: false,
    })

    expect(result.signatureIncluded).toBe(false)
    expect(result.html).not.toContain('data-email-signature')
    expect(result.text).toBe('Hello Jane')
  })

  it('applies firm branding after assembling the authored body and signature', async () => {
    loadFirmSettings.mockResolvedValue({
      firmName: 'Aubrey Law',
      email: 'office@example.com',
      city: 'Acton',
      emailLogoHeader: true,
      emailSignatureHtml: '<p>Attorney Aubrey</p>',
      emailSignatureDefault: true,
    })

    const result = await assembleManualEmail({ html: '<p>Hello</p>', includeSignature: true })
    expect(result.html).toContain('<!DOCTYPE html>')
    expect(result.html).toContain('Attorney Aubrey')
    expect(result.html).toContain('AUBREY')
  })
})
