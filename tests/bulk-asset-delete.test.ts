import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('bulk asset delete', () => {
  it('exposes bulk delete API and selection UI on the assets tab', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/assets/[id]/bulk-delete/route.ts'),
      'utf8',
    )
    const assetsTab = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/tabs/assets.tsx'),
      'utf8',
    )
    const table = fs.readFileSync(path.join(process.cwd(), 'components/assets/AssetTable.tsx'), 'utf8')

    expect(route).toContain('.delete()')
    expect(route).toContain("from('asset_intake')")
    expect(route).toContain('MAX_BULK_DELETE')
    expect(assetsTab).toContain('deleteAssets')
    expect(assetsTab).toContain('Delete selected')
    expect(table).toContain('Checkbox')
    expect(table).toContain('onToggleAllVisible')
  })
})
