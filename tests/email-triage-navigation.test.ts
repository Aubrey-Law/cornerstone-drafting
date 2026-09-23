import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { adminNavItems } from '@/app/admin/AdminLayoutClient'
import { EMPTY_SIDEBAR_COUNTS, getNavBadge } from '@/lib/sidebarBadges'

const HREF = '/admin/email-triage'

function source(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

describe('email triage navigation', () => {
  it('is in the shared desktop and mobile navigation source', () => {
    expect(adminNavItems.some(item => item.href === HREF && item.label === 'Email triage')).toBe(true)
  })

  it('sits in the Daily group, beside Today', () => {
    // It is a morning surface, not a record view: filed anywhere else it would
    // not be seen at the moment it is useful.
    expect(adminNavItems.find(item => item.href === HREF)?.group).toBe('Daily')
  })

  it('is reachable from the command palette', () => {
    // A separate, duplicated list from the sidebar's — easy to forget, so it
    // gets its own assertion rather than being assumed.
    expect(source('components/GlobalSearch.tsx')).toContain(HREF)
  })

  it('badges waiting mail without borrowing the portal message count', () => {
    // inboxNeedsReplyCount is unread portal messages and is already bound to
    // /admin. Reusing it here would double-count one number in two places.
    const counts = { ...EMPTY_SIDEBAR_COUNTS, emailTriageNeedsReplyCount: 4 }
    expect(getNavBadge(HREF, counts)).toEqual({ value: 4, tone: 'accent' })
    expect(getNavBadge('/admin', counts)).toBeNull()
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
