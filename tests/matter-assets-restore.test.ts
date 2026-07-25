import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('matter assets prior design restore', () => {
  it('renders the portfolio summary and donut charts from the prior design', () => {
    const assets = read('app/admin/matters/[id]/tabs/assets.tsx')

    expect(assets).toContain('AssetPortfolioSummary')
    expect(assets).toContain('AssetDonutChart')
    expect(assets).not.toContain('AssetValueBars')
    expect(assets).not.toContain("filter(cat => cat.key !== 'life_insurance')")
  })

  it('restores the complete table and direct row actions', () => {
    const table = read('components/assets/AssetTable.tsx')

    expect(table).toContain('<th className="px-4 py-3">Type</th>')
    expect(table).toContain('>Debt</th>')
    expect(table).toContain('>Files</th>')
    expect(table).toContain('aria-label="Edit asset"')
    expect(table).toContain('aria-label="Delete asset"')
    expect(table).not.toContain('MoreHorizontal')
  })

  it('preserves bulk operations, editing, export, and design-sheet sync', () => {
    const assets = read('app/admin/matters/[id]/tabs/assets.tsx')

    expect(assets).toContain('deleteAssets')
    expect(assets).toContain('BulkAssetsDialog')
    expect(assets).toContain('AssetFormDialog')
    expect(assets).toContain('exportReport')
    expect(assets).toContain('handleSyncDesignSheet')
  })
})
