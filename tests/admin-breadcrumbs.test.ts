import { describe, expect, it } from 'vitest'

import { adminBreadcrumbs } from '@/lib/adminBreadcrumbs'

const MATTER = '3f2b8c1e-9d4a-4b7c-8e15-0a6d2f4c9b11'
const INVOICE = '7a1c4e92-33b8-4d05-9f6e-2c81b0d7a4f3'

/**
 * The trail is derived from the pathname alone, so these are the app's real
 * routes rather than invented ones — every path here comes from a `page.tsx`
 * under `app/admin`.
 */
describe('adminBreadcrumbs', () => {
  it('says nothing on a top-level page', () => {
    // The sidebar highlights Tasks and the page title says Tasks. A third
    // "Tasks" in the header is the noise this guard exists to prevent.
    expect(adminBreadcrumbs('/admin/tasks')).toEqual([])
    expect(adminBreadcrumbs('/admin/calendar')).toEqual([])
    expect(adminBreadcrumbs('/admin/settings')).toEqual([])
    expect(adminBreadcrumbs('/admin')).toEqual([])
  })

  it('says nothing for the matters list, which is the Matters page', () => {
    expect(adminBreadcrumbs('/admin/matters/list')).toEqual([])
  })

  it('names the record when the shell has resolved it', () => {
    expect(adminBreadcrumbs(`/admin/matters/${MATTER}`, { recordLabel: 'Alvarez Family Trust' })).toEqual([
      { label: 'Matters', href: '/admin/matters/list' },
      { label: 'Alvarez Family Trust' },
    ])
  })

  it('falls back to the section noun rather than showing a raw id', () => {
    const trail = adminBreadcrumbs(`/admin/matters/${MATTER}`)
    expect(trail).toEqual([
      { label: 'Matters', href: '/admin/matters/list' },
      { label: 'Matter' },
    ])
    expect(JSON.stringify(trail)).not.toContain(MATTER)
  })

  it('treats a blank resolved label as unresolved', () => {
    // The hook returns '' while a matter row has no name yet; that must not
    // render an empty crumb.
    expect(adminBreadcrumbs(`/admin/matters/${MATTER}`, { recordLabel: '   ' })[1]).toEqual({
      label: 'Matter',
    })
  })

  it('links the record on the way to a sub-page', () => {
    expect(adminBreadcrumbs(`/admin/matters/${MATTER}/design`, { recordLabel: 'Okonkwo' })).toEqual([
      { label: 'Matters', href: '/admin/matters/list' },
      { label: 'Okonkwo', href: `/admin/matters/${MATTER}` },
      { label: 'Design sheet' },
    ])
  })

  it('carries the matter name through the drafting routes', () => {
    expect(adminBreadcrumbs(`/admin/drafting/${MATTER}/quick`, { recordLabel: 'Okonkwo' })).toEqual([
      { label: 'Drafting', href: '/admin/drafting' },
      { label: 'Okonkwo', href: `/admin/drafting/${MATTER}` },
      { label: 'Quick draft' },
    ])
  })

  it('builds a four-deep trail through billing', () => {
    expect(adminBreadcrumbs(`/admin/billing/invoices/${INVOICE}/edit`)).toEqual([
      { label: 'Billing', href: '/admin/billing' },
      { label: 'Invoices', href: '/admin/billing/invoices' },
      { label: 'Invoice', href: `/admin/billing/invoices/${INVOICE}` },
      { label: 'Edit' },
    ])
  })

  it('prefers the longest matching section', () => {
    // `/admin/crm` would also match, and would label this CRM rather than Leads.
    expect(adminBreadcrumbs('/admin/crm/opportunities/12')[0]).toEqual({
      label: 'Leads',
      href: '/admin/crm/opportunities',
    })
  })

  /**
   * The rule that keeps a 404 out of the chrome: `/admin/assistant/chat` has no
   * page of its own, only `/admin/assistant/chat/[chatId]`, so that crumb is
   * text. Remove the NAVIGABLE_SEGMENTS check and this goes red.
   */
  it('does not link a path component that has no page behind it', () => {
    const trail = adminBreadcrumbs('/admin/assistant/chat/abc123def456ghi789')
    expect(trail).toEqual([
      { label: 'Assistant', href: '/admin/assistant' },
      { label: 'Chat' },
      { label: 'Chat' },
    ])
    expect(trail[1].href).toBeUndefined()
  })

  it('renders a section with no index page as plain text', () => {
    // There is no `/admin/engagements` page, only the agreement detail.
    expect(adminBreadcrumbs(`/admin/engagements/${INVOICE}`)).toEqual([
      { label: 'Engagements' },
      { label: 'Agreement' },
    ])
  })

  it('humanizes a segment it has never been told about', () => {
    // A route added later gets a readable crumb without touching the map.
    expect(adminBreadcrumbs('/admin/settings/billing-defaults')).toEqual([
      { label: 'Settings', href: '/admin/settings' },
      { label: 'Billing defaults' },
    ])
  })

  it('ignores anything outside the admin app', () => {
    expect(adminBreadcrumbs('/dashboard/documents')).toEqual([])
    expect(adminBreadcrumbs('/intake/start')).toEqual([])
  })

  it('never returns a trail whose last crumb is a link', () => {
    for (const path of [
      `/admin/matters/${MATTER}`,
      `/admin/matters/${MATTER}/design`,
      `/admin/billing/invoices/${INVOICE}/edit`,
      '/admin/settings/style-sets',
      '/admin/crm/people',
    ]) {
      const trail = adminBreadcrumbs(path)
      expect(trail.at(-1)?.href, path).toBeUndefined()
    }
  })
})
