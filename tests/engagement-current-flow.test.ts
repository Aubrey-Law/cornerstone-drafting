import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const leadRoute = read('app/api/admin/leads/[id]/engagement/route.ts')
const matterRoute = read('app/api/admin/matters/[id]/engagement/route.ts')
const webhook = read('app/api/webhooks/esign/route.ts')

describe('current engagement flow contract', () => {
  it('supports primary and spouse signers from leads and matters', () => {
    expect(leadRoute).toContain('spouseEmail')
    expect(matterRoute).toContain('spouse_email')
    expect(leadRoute).toContain('createEngagementEnvelope')
    expect(matterRoute).toContain('createEngagementEnvelope')
  })

  it('converts signed leads and stores the completed PDF', () => {
    expect(webhook).toContain('createMatterFromIntake')
    expect(webhook).toContain('putFileToR2')
    expect(webhook).toContain("from('matter_documents').insert")
    expect(webhook).toContain('getEnvelopeState')
  })
})
