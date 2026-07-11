import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/matters/[id]/engagement/route.ts'),
  'utf8',
)

describe('engagement send route source shape', () => {
  it('requires admin auth', () => {
    expect(source).toContain('requireAdmin')
  })

  it('returns 501 when e-sign is unconfigured', () => {
    expect(source).toContain('resolveEsignProvider')
    expect(source).toContain('501')
  })

  it('refuses to resend a signed engagement', () => {
    expect(source).toContain('409')
    expect(source).toContain('engagement_signed')
  })

  it('cancels superseded envelopes and upserts by matter', () => {
    expect(source).toContain('cancelEnvelope')
    expect(source).toContain("onConflict: 'client_id'")
    expect(source).toContain("engagement_status: 'sent'")
  })
})
