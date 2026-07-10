import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('admin intake questionnaire uploads', () => {
  it('exposes staff routes for listing and downloading intake documents', () => {
    const listRoute = path.join(
      process.cwd(),
      'app/api/admin/intake/[intakeId]/documents/route.ts',
    )
    const downloadRoute = path.join(
      process.cwd(),
      'app/api/admin/intake/documents/[id]/route.ts',
    )

    expect(fs.existsSync(listRoute)).toBe(true)
    expect(fs.existsSync(downloadRoute)).toBe(true)

    const listSource = fs.readFileSync(listRoute, 'utf8')
    const downloadSource = fs.readFileSync(downloadRoute, 'utf8')

    expect(listSource).toContain('requireAdmin')
    expect(listSource).toContain("from('intake_documents')")
    expect(downloadSource).toContain('getSignedUrl')
    expect(downloadSource).toContain("from('intake_documents')")
  })

  it('matter resync card reads preview rows from the API array', () => {
    const card = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/IntakeSyncStatusCard.tsx'),
      'utf8',
    )
    expect(card).toContain('Array.isArray(previewBody.preview)')
    expect(card).not.toContain('previewBody.preview?.fields')
  })
})
