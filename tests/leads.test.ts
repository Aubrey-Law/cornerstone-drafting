import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

describe('lead tracking source shape', () => {
  it('leads page lists standalone intakes (no matter)', () => {
    const source = read('app/admin/leads/page.tsx')
    expect(source).toContain("is('matter_id', null)")
    expect(source).toContain('isEsignConfigured')
  })

  it('lead creation inserts a standalone client_intake', () => {
    const source = read('app/api/admin/leads/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain("from('client_intake')")
    expect(source).toContain('engagement_fee_quoted')
  })

  it('lead engagement send guards converted and signed leads', () => {
    const source = read('app/api/admin/leads/[id]/engagement/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('501')
    expect(source).toContain('409')
    expect(source).toContain("engagement_status: 'sent'")
  })

  it('intake send supports lead intakes without a matter', () => {
    const source = read('app/api/admin/intake/send/route.ts')
    expect(source).toContain('intakeId')
    expect(source).toContain('matterId or intakeId is required')
  })

  it('conversion is idempotent and carries fee + engagement state', () => {
    const source = read('lib/matters/createFromIntake.ts')
    expect(source).toContain("eq('client_intake_id', intakeId)")
    expect(source).toContain('engagement_fee_quoted')
    expect(source).toContain('flat_fee_amount')
    expect(source).toContain('ensureDesignSheetSeededFromIntake')
  })

  it('webhook converts a signed lead into a matter', () => {
    const source = read('app/api/webhooks/esign/route.ts')
    expect(source).toContain('createMatterFromIntake')
    expect(source).toContain("from('client_intake')")
    expect(source).toContain('storeSignedEngagement')
  })
})

describe('lead edit and delete source shape', () => {
  it('edit/delete route exports PATCH and DELETE with a converted guard', () => {
    const source = read('app/api/admin/leads/[id]/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain('export async function DELETE')
    expect(source).toContain('409')
    expect(source).toContain('deleteLead')
  })

  it('bulk-delete route loops ids through deleteLead', () => {
    const source = read('app/api/admin/leads/bulk-delete/route.ts')
    expect(source).toContain('requireAdmin')
    expect(source).toContain('deleteLead')
    expect(source).toContain('results')
  })

  it('deleteLead refuses converted leads and cleans up the envelope + R2', () => {
    const source = read('lib/leads/deleteLead.ts')
    expect(source).toContain('already converted')
    expect(source).toContain('cancelEnvelope')
    expect(source).toContain('r2_key')
    expect(source).toContain("from('client_intake').delete()")
  })

  it('leads client has selection, bulk delete, and an edit dialog', () => {
    const source = read('app/admin/leads/LeadsClient.tsx')
    expect(source).toContain('Checkbox')
    expect(source).toContain('bulk-delete')
    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain('Edit lead')
  })
})
