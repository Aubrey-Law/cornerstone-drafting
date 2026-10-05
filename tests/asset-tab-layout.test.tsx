// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetCategoryFilters } from '@/components/assets/AssetCategoryFilters'
import { AssetTable } from '@/components/assets/AssetTable'
import { groupAssetsByCategory } from '@/lib/assets/aggregates'
import { buildOwnershipLabels } from '@/lib/assets/labels'
import type { AssetIntakeRow } from '@/types/assetIntake'

afterEach(cleanup)

const asset = (id: string, category: string, description: string, extra: Partial<AssetIntakeRow> = {}) => ({
  id, client_intake_id: 'i1', category, description, value: 1000, ownership: 'spouse', details: {},
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...extra,
}) as AssetIntakeRow

describe('asset tab layout', () => {
  it('offers a chip for every category present, named like its group, with counts', () => {
    const groups = groupAssetsByCategory([
      asset('a', 'life_insurance', 'MetLife term'),
      asset('b', 'business', 'LLC interest'),
      asset('c', 'business', 'Second LLC'),
    ])
    render(
      <AssetCategoryFilters
        value="all"
        onChange={vi.fn()}
        options={groups.map(group => ({ key: group.key, label: group.label, count: group.assets.length }))}
      />,
    )
    const chips = screen.getAllByRole('button').map(chip => chip.textContent)
    expect(chips).toEqual(['All· 3', 'Life Insurance· 1', 'Business Interests· 2'])
  })

  it('calls an unnamed spouse "Spouse", not the drafting software\'s "Settlor 2"', () => {
    expect(buildOwnershipLabels(null, null)).toEqual({ client: 'Client', spouse: 'Spouse', joint: 'Joint' })
    expect(buildOwnershipLabels('Jordan Client', 'Sam Client').spouse).toBe('Sam Client')
  })

  it('shows an asset\'s description once, and under its institution only when they differ', () => {
    render(
      <AssetTable
        groups={groupAssetsByCategory([
          asset('a', 'bank', 'Citizens checking'),
          asset('b', 'bank', 'Joint savings', { details: { institution: 'Citizens Bank' } }),
        ])}
        ownershipLabels={buildOwnershipLabels(null, null)}
        selectedIds={new Set()}
        onToggleSelected={vi.fn()}
        onToggleAllVisible={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getAllByText('Citizens checking')).toHaveLength(1)
    const row = screen.getByText('Citizens Bank').closest('tr') as HTMLElement
    expect(within(row).getByText('Joint savings')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Description' })).toBeNull()
  })
})
