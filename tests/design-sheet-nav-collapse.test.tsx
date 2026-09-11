// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponsiveDetailRail } from '@/components/layout/ResponsiveDetailRail'
import { DesignSectionNav } from '@/app/admin/drafting/[matterId]/design/DesignSectionNav'
import { DESIGN_SHEET_GROUP_IDS } from '@/lib/designSheet/sectionIds'
import { parseUserPreferences, resolveDesignNavCollapsed } from '@/lib/userPreferences'

const mediaState = vi.hoisted(() => ({ mobile: false }))

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? mediaState.mobile : !mediaState.mobile,
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  mediaState.mobile = false
  installMatchMedia()
})

afterEach(cleanup)

const navGroups = [
  { id: DESIGN_SHEET_GROUP_IDS.facts, title: 'Client facts', blockingCount: 2, optionalCount: 0 },
  { id: DESIGN_SHEET_GROUP_IDS.fiduciaries, title: 'Fiduciaries', blockingCount: 0, optionalCount: 1 },
]

function renderNav(open: boolean, onOpenChange = vi.fn()) {
  return render(
    <ResponsiveDetailRail
      open={open}
      onOpenChange={onOpenChange}
      label="Design sheet sections"
      desktopClassName="border-r border-border pr-3"
      desktopStyle={{ position: 'sticky', top: 60 }}
    >
      <DesignSectionNav
        groups={navGroups}
        hideUnusedDecisions
        hiddenDecisionCount={3}
        onHideUnusedChange={vi.fn()}
        onSelectGroup={vi.fn()}
      />
    </ResponsiveDetailRail>,
  )
}

describe('design sheet section index', () => {
  it('docks beside the form when open on desktop', () => {
    renderNav(true)

    const rail = screen.getByRole('complementary', { name: 'Design sheet sections' })
    expect(rail.style.position).toBe('sticky')
    expect(screen.getByRole('navigation', { name: 'Design sheet groups' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Client facts/ })).toBeTruthy()
  })

  it('removes the column entirely when collapsed, leaving no empty rail', () => {
    renderNav(false)

    expect(screen.queryByRole('complementary', { name: 'Design sheet sections' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Design sheet groups' })).toBeNull()
  })

  it('moves the index into a named sheet on mobile instead of a docked column', () => {
    mediaState.mobile = true
    renderNav(true)

    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    // One copy of the index, not one per breakpoint.
    expect(screen.getAllByRole('navigation', { name: 'Design sheet groups' })).toHaveLength(1)
  })

  it('reports blocking and optional counts per group', () => {
    renderNav(true)

    const facts = screen.getByRole('button', { name: /Client facts/ })
    expect(facts.textContent).toContain('2')
    const fiduciaries = screen.getByRole('button', { name: /Fiduciaries/ })
    expect(fiduciaries.textContent).toContain('1')
  })

  it('jumps to a group when a link is activated by keyboard', async () => {
    const onSelectGroup = vi.fn()
    const user = userEvent.setup()
    render(
      <DesignSectionNav
        groups={navGroups}
        hideUnusedDecisions
        hiddenDecisionCount={0}
        onHideUnusedChange={vi.fn()}
        onSelectGroup={onSelectGroup}
      />,
    )

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    expect(onSelectGroup).toHaveBeenCalledWith(DESIGN_SHEET_GROUP_IDS.facts)
  })
})

describe('design sheet index preference', () => {
  it('starts expanded and round-trips an explicit collapse', () => {
    expect(resolveDesignNavCollapsed(null)).toBe(false)
    expect(resolveDesignNavCollapsed(parseUserPreferences({ drafting: {} }))).toBe(false)
    expect(resolveDesignNavCollapsed(parseUserPreferences({ drafting: { designNavCollapsed: true } }))).toBe(true)
  })

  it('is saved from the design sheet toggle and drives the grid columns', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )

    expect(source).toContain('savePreferences({ drafting: { designNavCollapsed: !open } })')
    expect(source).toContain('aria-pressed={navOpen}')
    expect(source).toContain("navOpen ? '244px' : null")
    // The phone layout is a single column, so nothing can overflow sideways.
    expect(source).toContain("isMobile\n    ? 'minmax(0, 1fr)'")
    expect(source).toContain('clausePreviewOpen && clausesDocked && !isMobile')
  })
})

describe('tasks page width', () => {
  it('fills the admin content area like the other list pages', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/tasks/TasksClient.tsx'), 'utf8')

    expect(source).not.toContain('max-w-[1100px]')
    expect(source).toContain('<div className="w-full space-y-4">')
  })
})
