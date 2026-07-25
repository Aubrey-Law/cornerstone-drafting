import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('matter assets redesign', () => {
  it('separates owned assets and insurance and uses exact-value bars', () => {
    const assets = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/tabs/assets.tsx'),
      'utf8',
    )

    expect(assets).toContain('AssetValueBars')
    expect(assets).toContain('Owned assets')
    expect(assets).toContain('Death benefit')
    expect(assets).toContain('conservative MA estimate')
    expect(assets).not.toContain('AssetDonutChart')
  })

  it('removes repeated type columns and conditionally shows debt and files', () => {
    const table = fs.readFileSync(
      path.join(process.cwd(), 'components/assets/AssetTable.tsx'),
      'utf8',
    )

    expect(table).not.toContain('<th className="px-4 py-3">Type</th>')
    expect(table).toContain('showDebt')
    expect(table).toContain('showFiles')
    expect(table).toContain('MoreHorizontal')
  })
})
