// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesignSectionNav } from '@/app/admin/drafting/[matterId]/design/DesignSectionNav'
import {
  DESIGN_SECTION_IDS,
  DESIGN_SHEET_GROUP_IDS,
  resolveDesignSheetGroupId,
} from '@/lib/designSheet/sectionIds'

const designRoot = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design')
const read = (relativePath: string) => fs.readFileSync(path.join(designRoot, relativePath), 'utf8')

afterEach(cleanup)

describe('deep-link group resolution', () => {
  it('accepts group ids directly, including the synthetic review section', () => {
    expect(resolveDesignSheetGroupId('trust')).toBe(DESIGN_SHEET_GROUP_IDS.trust)
    expect(resolveDesignSheetGroupId('review')).toBe(DESIGN_SHEET_GROUP_IDS.review)
    expect(resolveDesignSheetGroupId('facts')).toBe(DESIGN_SHEET_GROUP_IDS.facts)
  })

  it('maps current and legacy section ids to their groups', () => {
    expect(resolveDesignSheetGroupId(DESIGN_SECTION_IDS.trustDetails)).toBe(DESIGN_SHEET_GROUP_IDS.trust)
    expect(resolveDesignSheetGroupId('dpoa')).toBe(DESIGN_SHEET_GROUP_IDS.powersOfAttorney)
    expect(resolveDesignSheetGroupId('plan-design')).toBe(DESIGN_SHEET_GROUP_IDS.plan)
  })

  it('returns null for unknown tokens and empty hashes', () => {
    expect(resolveDesignSheetGroupId('')).toBeNull()
    expect(resolveDesignSheetGroupId(null)).toBeNull()
    expect(resolveDesignSheetGroupId('not-a-section')).toBeNull()
  })
})

describe('sectioned nav rail', () => {
  const navGroups = [
    { id: DESIGN_SHEET_GROUP_IDS.facts, title: 'Facts from intake', blockingCount: 2, optionalCount: 0 },
    { id: DESIGN_SHEET_GROUP_IDS.trust, title: 'Trust terms', blockingCount: 0, optionalCount: 1 },
    { id: DESIGN_SHEET_GROUP_IDS.review, title: 'Review & sign', blockingCount: 0, optionalCount: 0 },
  ]

  it('marks the active group with aria-current and selects on click', async () => {
    const onSelectGroup = vi.fn()
    const user = userEvent.setup()
    render(
      <DesignSectionNav
        groups={navGroups}
        activeGroupId={DESIGN_SHEET_GROUP_IDS.trust}
        hideUnusedDecisions
        hiddenDecisionCount={0}
        onHideUnusedChange={vi.fn()}
        onSelectGroup={onSelectGroup}
      />,
    )

    const active = screen.getByRole('button', { name: /Trust terms/ })
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: /Facts from intake/ }).getAttribute('aria-current')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Review & sign/ }))
    expect(onSelectGroup).toHaveBeenCalledWith(DESIGN_SHEET_GROUP_IDS.review)
  })
})

describe('sectioned design sheet page wiring', () => {
  const page = read('DesignSheetPage.tsx')

  it('mounts only the active group and appends the review section', () => {
    expect(page).toContain('{activeGroup.render()}')
    expect(page).not.toContain('{groups.map(group => {')
    expect(page).toContain('<SigningMechanicsSection')
    expect(page).toContain('<DesignFinalReview')
    expect(page).toContain("{ id: REVIEW_GROUP.id, title: REVIEW_GROUP.title, blockingCount: 0, optionalCount: 0 }")
  })

  it('keeps the hash contract and seeds the active group from the URL', () => {
    expect(page).toContain("window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${groupId}`)")
    expect(page).toContain("resolveDesignSheetGroupId(window.location.hash.replace(/^#/, ''))")
  })

  it('falls back to the first visible group when the active one is hidden', () => {
    expect(page).toContain('if (activeGroupId && navGroups.some(group => group.id === activeGroupId)) return activeGroupId')
    expect(page).toContain('return navGroups[0]?.id ?? REVIEW_GROUP.id')
  })

  it('orders Back/Next by the visible group list', () => {
    expect(page).toContain('const previousGroup = activeIndex > 0 ? navGroups[activeIndex - 1] : null')
    expect(page).toContain('activeIndex < navGroups.length - 1 ? navGroups[activeIndex + 1] : null')
    expect(page).toContain('Back: {previousGroup.title}')
    expect(page).toContain('Next: {nextGroup.title}')
  })

  it('moves focus to the section heading or blocked field on selection', () => {
    expect(page).toContain("document.getElementById('design-active-group-heading')")
    expect(page).toContain('heading.focus({ preventScroll: true })')
    expect(page).toContain('designFieldTargetId(targetField)')
    expect(page).toContain('flashDesignTarget(target)')
  })

  it('routes blocker chips through field targeting and flashes fiduciary grid roles', () => {
    expect(page).toContain('handleBlockerSelect(item)')
    expect(page).toContain("selectGroup(groupId, { targetField: item.targetField })")
    expect(page).toContain("item.targetField?.endsWith('_slots')")
    expect(page).toContain('setFiduciaryFlashField(item.targetField)')
  })

  it('still applies initialFocus deep links to the target field', () => {
    expect(page).toContain('shouldApplyDesignInitialFocus(initialFocus, normalizedSectionId, appliedInitialFocusRef.current)')
    expect(page).toContain('initialFocus.targetField ? designFieldTargetId(initialFocus.targetField) : null')
  })
})

describe('fiduciary grid role flashing', () => {
  const grid = read('sections/FiduciaryGrid.tsx')

  it('accepts flashRoleKey and tints the role column header and cells', () => {
    expect(grid).toContain('flashRoleKey = null')
    expect(grid).toContain("flashRoleKey.startsWith('spouse_') ? 'spouse' : 'client'")
    expect(grid).toContain("flashing ? 'bg-warning/10' : 'bg-muted/40'")
    expect(grid).toContain("? 'bg-warning/10 text-muted-foreground'")
  })
})
