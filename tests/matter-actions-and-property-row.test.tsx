// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { buildMatterActions } from '@/lib/matters/matterActions'
import { PropertyList, PropertyRow } from '@/components/ui/property-row'

const target = { matterId: 'm-1', title: 'Jane Smith', isPinned: false }

describe('matter actions', () => {
  it('omits rename and delete when the surface supplies nowhere for them to go', () => {
    const keys = buildMatterActions(target, { onTogglePin: vi.fn() }).map(i => i.key)
    expect(keys).toEqual(['open-new-tab', 'copy-link', 'toggle-pin'])
  })

  it('includes them once handlers exist, with delete last and destructive', () => {
    const items = buildMatterActions(target, {
      onTogglePin: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items.map(i => i.key)).toEqual([
      'open-new-tab',
      'rename',
      'copy-link',
      'toggle-pin',
      'delete',
    ])

    const del = items.at(-1)
    expect(del?.variant).toBe('destructive')
    // Separated so it cannot be hit while reaching for the item above it.
    expect(del?.separatorBefore).toBe(true)
  })

  it('names the pin action for what it will do, not for the current state', () => {
    const pin = buildMatterActions(target, { onTogglePin: vi.fn() }).find(i => i.key === 'toggle-pin')
    expect(pin?.label).toBe('Pin')

    const unpin = buildMatterActions({ ...target, isPinned: true }, { onTogglePin: vi.fn() })
      .find(i => i.key === 'toggle-pin')
    expect(unpin?.label).toBe('Unpin')
  })

  it('offers reordering only for a matter that is pinned', () => {
    const handlers = { onTogglePin: vi.fn(), onMovePin: vi.fn() }
    expect(buildMatterActions(target, handlers).map(i => i.key)).not.toContain('move-up')

    const pinned = buildMatterActions({ ...target, isPinned: true }, handlers)
    expect(pinned.map(i => i.key)).toContain('move-up')
    expect(pinned.map(i => i.key)).toContain('move-down')
  })

  it('reorders through the menu rather than through row buttons', () => {
    // A pinned row shows its cluster without hovering, so inline arrows would
    // sit over the title permanently.
    const onMovePin = vi.fn()
    buildMatterActions({ ...target, isPinned: true }, { onTogglePin: vi.fn(), onMovePin })
      .find(i => i.key === 'move-up')
      ?.onSelect()
    expect(onMovePin).toHaveBeenCalledWith('m-1', -1)
  })

  it('passes the matter id to the pin handler', () => {
    const onTogglePin = vi.fn()
    buildMatterActions(target, { onTogglePin }).find(i => i.key === 'toggle-pin')?.onSelect()
    expect(onTogglePin).toHaveBeenCalledWith('m-1')
  })
})

describe('PropertyRow', () => {
  afterEach(cleanup)

  it('renders a supplied value', () => {
    render(<PropertyList><PropertyRow label="Email" value="jane@example.com" /></PropertyList>)
    expect(screen.getByText('jane@example.com')).toBeTruthy()
  })

  it('renders an em dash for values that are absent, empty, or whitespace only', () => {
    render(
      <PropertyList>
        <PropertyRow label="Missing" value={null} />
        <PropertyRow label="Undefined" value={undefined} />
        <PropertyRow label="Empty" value="" />
        <PropertyRow label="Spaces" value="   " />
      </PropertyList>,
    )
    // Every blank row still occupies its slot, so the column stays aligned.
    expect(screen.getAllByLabelText('Not recorded')).toHaveLength(4)
  })

  it('does not treat zero as blank', () => {
    render(<PropertyList><PropertyRow label="Children" value={0} /></PropertyList>)
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.queryByLabelText('Not recorded')).toBeNull()
  })

  it('keeps the label visible beside an empty value', () => {
    render(<PropertyList><PropertyRow label="County" value={null} /></PropertyList>)
    expect(screen.getByText('County')).toBeTruthy()
  })
})
