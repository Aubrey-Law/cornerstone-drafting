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

  it('shows no badge when the count failed to load', () => {
    // A failed read must not render as a confident zero or a stale number.
    const counts = {
      ...EMPTY_SIDEBAR_COUNTS,
      emailTriageNeedsReplyCount: 4,
      errors: ['emailTriageNeedsReplyCount'],
    }
    expect(getNavBadge(HREF, counts)).toBeNull()
  })

  it('leaves the retired inbox stub alone', () => {
    // app/admin/inbox belongs to the retired calling and SMS work, not to
    // email. Repurposing it would break the redirect that still serves it.
    expect(source('app/admin/inbox/page.tsx')).toContain("redirect('/admin')")
  })
})
