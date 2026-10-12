// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdminSidebar } from '@/app/admin/components/AdminSidebar'
import { ADMIN_NAV_GROUPS, adminNavItems } from '@/app/admin/adminNav'
import { EMPTY_SIDEBAR_COUNTS } from '@/lib/sidebarBadges'
import type { SidebarMattersState } from '@/lib/matters/useSidebarMatters'

const NAV_GROUP_EXPANDED_KEY = 'cornerstone.admin.navGroupsExpanded'

const matters: SidebarMattersState = {
  pinned: [],
  recent: [{
    matter_id: 'm1',
    title: 'Jordan Client',
    client_name: 'Jordan Client',
    matter_number: '2026-EP-FIXTURE-1',
    last_milestone_at: '2026-10-01T00:00:00.000Z',
  }],
  loading: false,
  isPinned: () => false,
  togglePin: () => {},
  movePin: () => {},
}

function renderRail(pathname: string) {
  return render(
    <AdminSidebar
      pathname={pathname}
      compact={false}
      badgeCounts={EMPTY_SIDEBAR_COUNTS}
      matters={matters}
      navItems={adminNavItems}
      navGroups={ADMIN_NAV_GROUPS}
      onNavigate={() => {}}
    />,
  )
}

describe('admin shell navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(cleanup)

  it('opens Operations on the first visit and keeps Tools closed', () => {
    renderRail('/admin')
    expect(screen.getByRole('button', { name: /Operations/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /Tools/ }).getAttribute('aria-expanded')).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(NAV_GROUP_EXPANDED_KEY) ?? '')).toEqual({ Operations: true })
  })

  it('keeps a stored collapse and still opens the group for the current route', () => {
    window.localStorage.setItem(NAV_GROUP_EXPANDED_KEY, JSON.stringify({ Operations: false }))
    renderRail('/admin/settings')
    expect(screen.getByRole('button', { name: /Operations/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /Tools/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('lists a matter once, without a second workspace tree', () => {
    renderRail('/admin')
    expect(screen.getAllByRole('link', { name: /Jordan Client/ })).toHaveLength(1)
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.queryByRole('link', { name: 'History' })).toBeNull()
  })

  it('does not collapse the rail when a drafting workspace opens', () => {
    const layout = fs.readFileSync(path.join(process.cwd(), 'app/admin/AdminLayoutClient.tsx'), 'utf8')
    expect(layout).not.toContain('wasOnDraftingWorkspace')
    expect(layout).toContain('forceCollapsed')
    expect(layout).toContain('setSidebarCollapsed')
  })
})
