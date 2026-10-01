import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { adminNavItems } from '@/app/admin/AdminLayoutClient'
import { EMPTY_SIDEBAR_COUNTS, getNavBadge } from '@/lib/sidebarBadges'

const HREF = '/admin/communications'

function source(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

describe('communications navigation', () => {
  it('is the shared desktop and mobile entry point', () => {
    expect(adminNavItems.some(item => item.href === HREF && item.label === 'Communications')).toBe(true)
  })

  it('sits in Operations while Today owns the daily decision queue', () => {
    expect(adminNavItems.find(item => item.href === HREF)?.group).toBe('Operations')
  })

  it('is reachable from the command palette', () => {
    // A separate, duplicated list from the sidebar's — easy to forget, so it
    // gets its own assertion rather than being assumed.
    expect(source('components/GlobalSearch.tsx')).toContain(HREF)
  })

  it('badges waiting mail in Communications and the authoritative Today queue', () => {
    // Specialist navigation and Today may both signal attention because Today
    // is now the cross-source decision queue rather than a portal-only inbox.
    const counts = { ...EMPTY_SIDEBAR_COUNTS, emailTriageNeedsReplyCount: 4 }
    expect(getNavBadge(HREF, counts)).toEqual({ value: 4, tone: 'accent' })
    expect(getNavBadge('/admin', counts)).toEqual({ value: 4, tone: 'accent' })
  })

  it('shows no badge when nothing is waiting', () => {
    expect(getNavBadge(HREF, EMPTY_SIDEBAR_COUNTS)).toBeNull()
  })

  it('marks the badge rather than hiding it when the count failed to load', () => {
    // This case previously asserted null, on the reasoning that a failed read
    // must render as neither a confident zero nor a stale number. The first
    // half still holds. The second turned out to trade one wrong answer for
    // another: hiding the badge is itself a confident claim, and the claim it
    // makes on a nav item is "nothing is waiting". So the last known count is
    // shown, and marked — dashed outline, muted, and announced as out of date.
    const counts = {
      ...EMPTY_SIDEBAR_COUNTS,
      emailTriageNeedsReplyCount: 4,
      errors: ['emailTriageNeedsReplyCount'],
    }
    expect(getNavBadge(HREF, counts)).toEqual({ value: 4, tone: 'accent', stale: true })
  })

  it('still shows nothing when the count failed before it ever loaded', () => {
    // No last known value, so there is nothing to mark stale.
    expect(getNavBadge(HREF, { ...EMPTY_SIDEBAR_COUNTS, errors: ['emailTriageNeedsReplyCount'] }))
      .toBeNull()
  })

  it('leaves the old inbox stub as a redirect', () => {
    // app/admin/inbox belongs to the calling and SMS work, not to email. Old
    // links land on the Texts page that replaced it.
    expect(source('app/admin/inbox/page.tsx')).toContain("redirect('/admin/texts')")
  })
})
