import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('bulk assets', () => {
  it('exposes a bulk insert API and dialog on the matter assets tab', () => {
    const bulkRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/assets/[id]/bulk/route.ts'),
      'utf8',
    )
    const assetsTab = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/tabs/assets.tsx'),
      'utf8',
    )
    const dialog = fs.readFileSync(
      path.join(process.cwd(), 'components/assets/BulkAssetsDialog.tsx'),
      'utf8',
    )

    expect(bulkRoute).toContain('insertAssetIntakeRows')
    expect(bulkRoute).toContain('MAX_BULK_ASSETS')
    expect(assetsTab).toContain('BulkAssetsDialog')
    expect(assetsTab).toContain('Bulk assets')
    expect(dialog).toContain('/api/admin/assets/${intakeId}/bulk')
    expect(dialog).toContain('/api/admin/assets/${intakeId}/import')
  })
})
